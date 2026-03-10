import { createOpencodeClient } from '@opencode-ai/sdk';
import type { Agent } from './agent.interface.js';
import type { Ticket, ColumnConfig } from '../types.js';
import { ticketRepository } from '../repositories/ticket.repository.js';
import { boardRepository } from '../repositories/board.repository.js';
import { commentRepository } from '../repositories/comment.repository.js';
import { setupOpencodeEventListener } from './opencode.events.js';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Helper function to execute commands robustly on Windows
async function runCmd(cmd: string, args: string[], cwd: string): Promise<{ stdout: string, stderr: string }> {
    console.log(`[opencode-agent] Running: ${cmd} ${args.join(' ')} in cwd: ${cwd}`);
    try {
        // First try execFile with shell: true which resolves .cmd and .exe automatically in PATH
        return await execFileAsync(cmd, args, { cwd, shell: true });
    } catch (e: any) {
        if (e.code === 'ENOENT') {
            console.log(`[opencode-agent] ENOENT with shell: true. Trying fallback exec...`);
            // Fallback to explicit cmd.exe if the default shell resolution failed
            return await execAsync(`${cmd} ${args.join(' ')}`, { cwd });
        }
        throw e;
    }
}

// Central OpenCode client connecting to the user's running OpenCode server
const opencodeClient = createOpencodeClient({ baseUrl: 'http://127.0.0.1:4096' });

// Track active session IDs by ticket ID to prevent/cancel overlaps
const activeSessions: Record<string, string> = {};

export class OpencodeAgent implements Agent {
    async run(ticket: Ticket, config: ColumnConfig): Promise<void> {
        console.log(`[opencode-agent] Starting session for ticket ${ticket.id}...`);

        // Provide immediate visual feedback on the Frontend
        ticketRepository.updateAgentSession(ticket.id, {
            column_id: ticket.column_id,
            agent_type: 'opencode',
            status: 'processing',
            port: 4096
        });

        // Prevent duplicate runs blocking new requests: replace the old session.
        if (activeSessions[ticket.id]) {
            console.log(`[opencode-agent] Session already running for ticket ${ticket.id}. Aborting old session to start a fresh one.`);
            try {
                // Ignore typescript error if abort typing differs slightly in SDK version
                await (opencodeClient.session as any).abort({ path: { id: activeSessions[ticket.id] } });
            } catch (e) {
                console.error(`[opencode-agent] Error aborting previous session:`, e);
            }
            delete activeSessions[ticket.id];
        }

        // 1. Find Worktree (For this MVP, we use the first folder workspace of the board)
        const board = boardRepository.findById(ticket.board_id);
        if (!board) throw new Error(`Board not found: ${ticket.board_id}`);

        const folderWorkspace = board.workspaces.find(ws => ws.type === 'folder');
        if (!folderWorkspace) {
            console.error(`[opencode-agent] No usable folder workspace found for board ${board.id}`);
            return;
        }
        let originalWorkspacePath = folderWorkspace.path;

        // Fix WSL path mapping if the Node server is running on Windows
        if (originalWorkspacePath.startsWith('/mnt/')) {
            const driveLetter = originalWorkspacePath.charAt(5).toUpperCase();
            originalWorkspacePath = `${driveLetter}:\\${originalWorkspacePath.slice(7).replace(/\//g, '\\')}`;
            console.log(`[opencode-agent] Normalized WSL path to Windows path for CWD: ${originalWorkspacePath}`);
        }

        // 2. Create Worktree
        const previousPrSession = [...(ticket.agent_sessions || [])].reverse().find(s => s.pr_url);
        const existingPrUrl = previousPrSession?.pr_url;

        let branchName = `ticket-${ticket.id}-${Date.now()}`;
        const tempWorktreePath = path.join(os.tmpdir(), 'openboard-worktrees', branchName);

        try {
            if (existingPrUrl) {
                console.log(`[opencode-agent] Found existing PR ${existingPrUrl}. Attempting to checkout existing branch.`);
                try {
                    const { stdout: prDataStr } = await runCmd('gh', ['pr', 'view', existingPrUrl, '--json', 'headRefName'], originalWorkspacePath);
                    const prData = JSON.parse(prDataStr);
                    if (prData.headRefName) {
                        branchName = prData.headRefName;
                        console.log(`[opencode-agent] Existing branch is ${branchName}. Checking it out into worktree.`);
                        // Check out the existing branch
                        await runCmd('git', ['worktree', 'add', tempWorktreePath, branchName], originalWorkspacePath);
                    } else {
                        throw new Error("Could not parse headRefName from PR");
                    }
                } catch (ghErr) {
                    console.warn(`[opencode-agent] Failed to fetch existing PR branch, falling back to new branch.`, ghErr);
                    await runCmd('git', ['worktree', 'add', '-b', branchName, tempWorktreePath], originalWorkspacePath);
                }
            } else {
                console.log(`[opencode-agent] Creating new git worktree for ticket ${ticket.id} at ${tempWorktreePath} on branch ${branchName}`);
                await runCmd('git', ['worktree', 'add', '-b', branchName, tempWorktreePath], originalWorkspacePath);
            }
        } catch (e: any) {
            console.error(`[opencode-agent] Failed to create git worktree: ${e.message}`);

            delete activeSessions[ticket.id];
            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'opencode',
                status: 'blocked',
                port: 4096,
                error_message: e.message
            });
            commentRepository.create({
                ticketId: ticket.id,
                author: 'System',
                content: `❌ **Failed to Initialize Worktree**\n\nThe agent could not prepare its isolated worktree.\nError: ${e.message}`
            });
            return;
        }

        // 3. Initialize Task
        try {
            // Create session
            const session = await opencodeClient.session.create({
                body: {
                    title: `Session for Ticket: ${ticket.title}`,
                },
                query: {
                    directory: tempWorktreePath
                }
            });

            if (!session.data) throw new Error("Failed to create OpenCode session");

            const sessionID = session.data.id;
            activeSessions[ticket.id] = sessionID;

            // Compute exact OpenCode Tracking URL
            const encodedPath = Buffer.from(tempWorktreePath).toString('base64url');
            const agentUrl = `http://127.0.0.1:4096/${encodedPath}/session/${sessionID}`;

            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'opencode',
                status: 'processing',
                port: 4096,
                url: agentUrl
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
                tempWorktreePath,
                originalWorkspacePath,
                branchName
            );
            // ------------------------------------------

            // Send first message asynchronously (doesn't wait for completion)

            let promptText = `# TASK: ${ticket.title}\n\n## Description\n${ticket.description}\n\n## Instructions\n1. The current working directory you should focus on is ${tempWorktreePath}.\n`;

            if (existingPrUrl) {
                promptText += `\n⚠️ **ATTENTION: CHANGES REQUESTED** ⚠️\nYou previously worked on this ticket and opened PR ${existingPrUrl}. However, changes were requested during code review.\n\nPlease use \`gh pr view ${existingPrUrl} --comments\` to read the requested changes, make the necessary code updates to fix the issues, and summarize your fixes.\n`;
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
                url: activeSessions[ticket.id] ? `http://127.0.0.1:4096/${Buffer.from(tempWorktreePath).toString('base64url')}/session/${activeSessions[ticket.id]}` : undefined,
                error_message: e.message
            });

            // Add a comment to explicitly tell the user what went wrong
            commentRepository.create({
                ticketId: ticket.id,
                author: 'System',
                content: `❌ **Agent Execution Failed**\n\nThe OpenCode agent failed to process this ticket.\nError: ${e.message}`
            });
        }
    }
}
