import { createOpencodeClient } from '@opencode-ai/sdk';
import type { Agent } from './agent.interface.js';
import type { Ticket, ColumnConfig } from '../types.js';
import { ticketRepository } from '../repositories/ticket.repository.js';
import { boardRepository } from '../repositories/board.repository.js';
import { commentRepository } from '../repositories/comment.repository.js';
import { setupOpencodeEventListener } from './opencode.events.js';
import { createBoardScopedClient } from '../utils/opencode.js';
import { runCmd, normalizePathForOS } from '../utils/os.js';
import { findFreePort } from '../utils/port.js';
import { processRegistry } from '../utils/process-registry.js';
import { spawn } from 'child_process';
import { activeSessions } from './active-sessions.js';
import path from 'path';
import fs from 'fs';

const opencodePort = process.env.OPENCODE_PORT || 4096;

export class OpencodeAgent implements Agent {
    async run(ticket: Ticket, config: ColumnConfig): Promise<void> {
        console.log(`[opencode-agent] Starting session for ticket ${ticket.id}...`);

        // A. Find an available port for this session early
        const dynamicPort = await findFreePort(Number(opencodePort));
        console.log(`[opencode-agent] Selected port ${dynamicPort} for ticket ${ticket.id}`);

        // Provide immediate visual feedback on the Frontend
        ticketRepository.updateAgentSession(ticket.id, {
            column_id: ticket.column_id,
            agent_type: 'opencode',
            status: 'processing',
            port: dynamicPort
        });

        // Create a board-scoped Opencode client for this ticket
        // (Will be re-created later once we have the dynamic port)
        const board = boardRepository.findById(ticket.board_id);

        // Prevent duplicate runs blocking new requests: replace the old session.

        // 1. Find Worktree (Use the board's designated path)
        let originalWorkspacePath = normalizePathForOS(board?.path || process.cwd());

        // 2. Set up Worktree
        // If this ticket already has a PR, we reuse the existing branch and worktree.
        // Worktree paths are derived from branch name so they are stable across re-runs.
        const latestTicket = ticketRepository.findById(ticket.id) || ticket;
        const previousPrSession = [...(latestTicket.agent_sessions || [])].reverse().find(s => s.pr_url);
        const existingPrUrl = previousPrSession?.pr_url;

        let branchName: string;
        let worktreePath: string;

        if (existingPrUrl) {
            // Ticket was already worked on — reuse the existing branch & worktree
            console.log(`[opencode-agent] Found existing PR ${existingPrUrl}. Fetching branch name.`);
            try {
                const { stdout: prDataStr } = await runCmd('gh', ['pr', 'view', existingPrUrl, '--json', 'headRefName'], originalWorkspacePath, 'opencode-agent');
                const prData = JSON.parse(prDataStr);
                if (!prData.headRefName) throw new Error('Could not parse headRefName from PR');
                branchName = prData.headRefName;
            } catch (ghErr: any) {
                console.warn(`[opencode-agent] Could not read PR branch name, will create a new branch.`, ghErr.message);
                branchName = `ticket-${ticket.id}-${Date.now()}`;
            }
        } else {
            // Fresh ticket — create a new branch and worktree
            branchName = `ticket-${ticket.id}-${Date.now()}`;
        }

        // Use a local folder within the board path for worktrees
        worktreePath = normalizePathForOS(path.join(originalWorkspacePath, '.openboard-worktrees', branchName));

        try {
            if (fs.existsSync(worktreePath)) {
                // Worktree directory already on disk — just reuse it, no git command needed
                console.log(`[opencode-agent] Reusing existing worktree at ${worktreePath} (branch: ${branchName})`);
            } else if (existingPrUrl) {
                // Branch exists but worktree was cleaned up — check out the branch into the path
                console.log(`[opencode-agent] Checking out existing branch ${branchName} into new worktree at ${worktreePath}`);
                await runCmd('git', ['worktree', 'add', worktreePath, branchName], originalWorkspacePath, 'opencode-agent');
            } else {
                // Completely new — check if the repo is empty (no commits yet)
                let isRepoEmpty = false;
                try {
                    await runCmd('git', ['rev-parse', 'HEAD'], originalWorkspacePath, 'opencode-agent');
                } catch (e) {
                    // if rev-parse HEAD fails, it usually means the repo has no commits
                    isRepoEmpty = true;
                    console.log(`[opencode-agent] Repository appears to be empty. Using --orphan for worktree.`);
                }

                if (isRepoEmpty) {
                    console.log(`[opencode-agent] Creating new orphan worktree at ${worktreePath} on branch ${branchName}`);
                    await runCmd('git', ['worktree', 'add', '--orphan', '-b', branchName, worktreePath], originalWorkspacePath, 'opencode-agent');
                } else {
                    console.log(`[opencode-agent] Creating new worktree at ${worktreePath} on branch ${branchName}`);
                    await runCmd('git', ['worktree', 'add', '-b', branchName, worktreePath], originalWorkspacePath, 'opencode-agent');
                }
            }
        } catch (e: any) {
            console.error(`[opencode-agent] Failed to create git worktree: ${e.message}`);

            delete activeSessions[ticket.id];
            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'opencode',
                status: 'blocked',
                port: Number(opencodePort),
                worktree_path: worktreePath,
                error_message: e.message
            });
            commentRepository.create({
                ticketId: ticket.id,
                author: 'opencode', // Use 'opencode' for consistency
                content: `❌ **Failed to Initialize Worktree**\n\nThe agent could not prepare its isolated worktree.\nError: ${e.message}`
            });
            return;
        }

        // 3. Initialize Task
        try {
            // B. Spawn `opencode serve` in the worktree
            const serverProcess = spawn('opencode', ['serve', '--port', dynamicPort.toString()], {
                cwd: worktreePath,
                env: { ...process.env, OPENCODE_PORT: dynamicPort.toString() },
                stdio: 'ignore', // Let it run in background silently
                detached: true
            });
            serverProcess.unref();

            // Register the process so it can be killed later
            processRegistry.register(ticket.id, serverProcess);

            // Wait a moment for server to start
            await new Promise(r => setTimeout(r, 2000));

            // C. Create the client for this specific port
            const opencodeClient = createBoardScopedClient(worktreePath, dynamicPort);

            // Create session
            const session = await opencodeClient.session.create({
                body: {
                    title: `Session for Ticket: ${ticket.title}`,
                },
                query: {
                    directory: worktreePath
                }
            });

            if (!session.data) throw new Error("Failed to create OpenCode session");

            const sessionID = session.data.id;
            activeSessions[ticket.id] = sessionID;

            // Compute exact OpenCode Tracking URL
            const encodedPath = Buffer.from(worktreePath).toString('base64url');
            const agentUrl = `http://127.0.0.1:${dynamicPort}/${encodedPath}/session/${sessionID}`;

            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'opencode',
                status: 'processing',
                port: dynamicPort,
                url: agentUrl,
                worktree_path: worktreePath
            });

            // --- Background Event Stream Listener ---
            const events = await opencodeClient.event.subscribe();

            // Start the event listener in the background without awaiting it
            setupOpencodeEventListener(
                events,
                opencodeClient,
                sessionID,
                ticket,
                agentUrl,
                config,
                activeSessions,
                worktreePath,
                originalWorkspacePath,
                branchName,
                'opencode',
                dynamicPort
            );
            // ------------------------------------------

            // Send first message asynchronously (doesn't wait for completion)

            // Fetch GH token so the LLM environment can execute `gh` commands
            let ghTokenEnv = '';
            try {
                const { stdout: ghToken } = await runCmd('gh', ['auth', 'token'], originalWorkspacePath, 'opencode-agent');
                if (ghToken.trim()) {
                    ghTokenEnv = `export GH_TOKEN=${ghToken.trim()}; `;
                }
            } catch (authErr) {
                console.warn(`[opencode-agent] Could not fetch GH token:`, authErr);
            }

            let promptText = `# TASK: ${ticket.title}\n\n## Description\n${ticket.description}\n\n## Instructions\n1. The current working directory you should focus on is ${worktreePath}.\n`;

            if (existingPrUrl) {
                promptText += `\n⚠️ **ATTENTION: CHANGES REQUESTED** ⚠️\nYou previously worked on this ticket and opened PR ${existingPrUrl}. However, changes were requested during code review.\n\nPlease use \`${ghTokenEnv}gh pr view ${existingPrUrl} --comments\` to read the requested changes, make the necessary code updates to fix the issues, and summarize your fixes.\n`;
            }

            const comments = await commentRepository.findByTicketId(ticket.id);

            if (comments.length > 0) {
                promptText += `\n\n Comments from the ticket:\n${comments.map(c => `${c.author}: ${c.content}`).join('\n')}`;
            }

            const promptRes = await opencodeClient.session.promptAsync({
                path: { id: sessionID },
                body: {
                    parts: [{
                        type: "text",
                        text: promptText
                    }]
                }
            });

            if (promptRes.error) {
                throw new Error(`OpenCode session error: ${JSON.stringify(promptRes.error)}`);
            }

            console.log(`[opencode-agent] Agent task dispatched for ticket ${ticket.id}. Waiting for completion in background.`);

        } catch (e: any) {
            console.error(`[opencode-agent] Failed to initialize task over SDK: ${e.message}`);
            delete activeSessions[ticket.id];

            // Mark the ticket as blocked due to error
            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'opencode',
                status: 'blocked',
                url: undefined,
                error_message: e.message
            });

            // Add a comment to explicitly tell the user what went wrong
            commentRepository.create({
                ticketId: ticket.id,
                author: 'opencode',
                content: `❌ **Agent Execution Failed**\n\nThe OpenCode agent failed to process this ticket.\nError: ${e.message}`
            });
        }
    }
}
