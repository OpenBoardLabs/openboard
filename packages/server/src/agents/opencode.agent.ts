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
import fs from 'fs';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Cache the gh token so we only fetch it once per server process
let cachedGhToken: string | null = null;
async function getGhToken(cwd: string): Promise<string | null> {
    if (cachedGhToken !== null) return cachedGhToken;
    try {
        const { stdout } = await execFileAsync('gh', ['auth', 'token'], { cwd });
        cachedGhToken = stdout.trim() || null;
    } catch {
        cachedGhToken = null;
    }
    return cachedGhToken;
}

// Helper function to execute commands robustly on Windows.
// Automatically injects GH_TOKEN for any `gh` subcommand.
async function runCmd(cmd: string, args: string[], cwd: string): Promise<{ stdout: string, stderr: string }> {
    console.log(`[opencode-agent] Running: ${cmd} ${args.join(' ')} in cwd: ${cwd}`);

    let extraEnv: Record<string, string> = {};
    if (cmd === 'gh') {
        const token = await getGhToken(cwd);
        if (token) extraEnv['GH_TOKEN'] = token;
    }
    const env = Object.keys(extraEnv).length > 0 ? { ...process.env, ...extraEnv } : undefined;

    try {
        return await execFileAsync(cmd, args, { cwd, ...(env && { env }) });
    } catch (e: any) {
        if (e.code === 'ENOENT') {
            console.log(`[opencode-agent] ENOENT finding binary. Trying fallback exec...`);
            const envPrefix = extraEnv['GH_TOKEN'] ? (process.platform === 'win32' ? `set GH_TOKEN=${extraEnv['GH_TOKEN']}&& ` : `GH_TOKEN=${extraEnv['GH_TOKEN']} `) : '';
            return await execAsync(`${envPrefix}${cmd} ${args.join(' ')}`, { cwd });
        }
        throw e;
    }
}

// Central OpenCode client connecting to the user's running OpenCode server
const opencodePort = process.env.OPENCODE_PORT || 4096;
const opencodeClient = createOpencodeClient({ baseUrl: `http://127.0.0.1:${opencodePort}` });

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
            port: Number(opencodePort)
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

        // 1. Find Worktree (Use the directory where openboard was started)
        let originalWorkspacePath = process.cwd();

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
                const { stdout: prDataStr } = await runCmd('gh', ['pr', 'view', existingPrUrl, '--json', 'headRefName'], originalWorkspacePath);
                const prData = JSON.parse(prDataStr);
                if (!prData.headRefName) throw new Error('Could not parse headRefName from PR');
                branchName = prData.headRefName;
            } catch (ghErr: any) {
                console.warn(`[opencode-agent] Could not read PR branch name, will create a new branch.`, ghErr.message);
                branchName = `ticket-${ticket.id}-${Date.now()}`;
            }
            worktreePath = path.join(os.tmpdir(), 'openboard-worktrees', branchName);
        } else {
            // Fresh ticket — create a new branch and worktree
            branchName = `ticket-${ticket.id}-${Date.now()}`;
            worktreePath = path.join(os.tmpdir(), 'openboard-worktrees', branchName);
        }

        try {
            if (fs.existsSync(worktreePath)) {
                // Worktree directory already on disk — just reuse it, no git command needed
                console.log(`[opencode-agent] Reusing existing worktree at ${worktreePath} (branch: ${branchName})`);
            } else if (existingPrUrl) {
                // Branch exists but worktree was cleaned up — check out the branch into the path
                console.log(`[opencode-agent] Checking out existing branch ${branchName} into new worktree at ${worktreePath}`);
                await runCmd('git', ['worktree', 'add', worktreePath, branchName], originalWorkspacePath);
            } else {
                // Completely new — create branch and worktree together
                console.log(`[opencode-agent] Creating new worktree at ${worktreePath} on branch ${branchName}`);
                await runCmd('git', ['worktree', 'add', '-b', branchName, worktreePath], originalWorkspacePath);
            }
        } catch (e: any) {
            console.error(`[opencode-agent] Failed to create git worktree: ${e.message}`);

            delete activeSessions[ticket.id];
            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'opencode',
                status: 'blocked',
                port: Number(opencodePort),
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
                    directory: worktreePath
                }
            });

            if (!session.data) throw new Error("Failed to create OpenCode session");

            const sessionID = session.data.id;
            activeSessions[ticket.id] = sessionID;

            // Compute exact OpenCode Tracking URL
            const encodedPath = Buffer.from(originalWorkspacePath).toString('base64url');
            const agentUrl = `http://127.0.0.1:${opencodePort}/${encodedPath}/session/${sessionID}`;

            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'opencode',
                status: 'processing',
                port: Number(opencodePort),
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
                worktreePath,
                originalWorkspacePath,
                branchName
            );
            // ------------------------------------------

            // Send first message asynchronously (doesn't wait for completion)

            // Fetch GH token so the LLM environment can execute `gh` commands
            let ghTokenEnv = '';
            try {
                const { stdout: ghToken } = await runCmd('gh', ['auth', 'token'], originalWorkspacePath);
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
                author: 'System',
                content: `❌ **Agent Execution Failed**\n\nThe OpenCode agent failed to process this ticket.\nError: ${e.message}`
            });
        }
    }
}
