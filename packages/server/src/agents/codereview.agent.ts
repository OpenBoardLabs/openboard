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
    console.log(`[codereview-agent] Running: ${cmd} ${args.join(' ')} in cwd: ${cwd}`);
    try {
        return await execFileAsync(cmd, args, { cwd, shell: true });
    } catch (e: any) {
        if (e.code === 'ENOENT') {
            console.log(`[codereview-agent] ENOENT with shell: true. Trying fallback exec...`);
            return await execAsync(`${cmd} ${args.join(' ')}`, { cwd });
        }
        throw e;
    }
}

const opencodeClient = createOpencodeClient({ baseUrl: 'http://127.0.0.1:4096' });
const activeSessions: Record<string, string> = {};

export class CodeReviewAgent implements Agent {
    async run(ticket: Ticket, config: ColumnConfig): Promise<void> {
        console.log(`[codereview-agent] Starting session for ticket ${ticket.id}...`);

        // Find the PR URL from a previous session
        const prUrlSession = [...(ticket.agent_sessions || [])].reverse().find(s => s.pr_url);
        const prUrl = prUrlSession?.pr_url;

        if (!prUrl) {
            console.error(`[codereview-agent] No PR URL found for ticket ${ticket.id}`);
            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'code_review',
                status: 'blocked',
                error_message: 'No PR found on this ticket to review. Make sure an OpenCode agent runs first.'
            });
            commentRepository.create({
                ticketId: ticket.id,
                author: 'System',
                content: `❌ **Code Review Failed**\n\nCould not find a Pull Request to review. Did the developer agent create one?`
            });
            return;
        }

        ticketRepository.updateAgentSession(ticket.id, {
            column_id: ticket.column_id,
            agent_type: 'code_review',
            status: 'processing',
            port: 4096
        });

        if (activeSessions[ticket.id]) {
            try {
                await (opencodeClient.session as any).abort({ path: { id: activeSessions[ticket.id] } });
            } catch (e) {
                console.error(`[codereview-agent] Error aborting previous session:`, e);
            }
            delete activeSessions[ticket.id];
        }

        // Find Worktree
        const board = boardRepository.findById(ticket.board_id);
        if (!board) throw new Error(`Board not found: ${ticket.board_id}`);

        const folderWorkspace = board.workspaces.find(ws => ws.type === 'folder');
        if (!folderWorkspace) {
            console.error(`[codereview-agent] No usable folder workspace found for board ${board.id}`);
            return;
        }
        let originalWorkspacePath = folderWorkspace.path;

        if (originalWorkspacePath.startsWith('/mnt/')) {
            const driveLetter = originalWorkspacePath.charAt(5).toUpperCase();
            originalWorkspacePath = `${driveLetter}:\\${originalWorkspacePath.slice(7).replace(/\//g, '\\')}`;
        }

        const branchName = `review-${ticket.id}-${Date.now()}`;
        const tempWorktreePath = path.join(os.tmpdir(), 'openboard-worktrees', branchName);

        try {
            console.log(`[codereview-agent] Creating git worktree for ticket ${ticket.id} at ${tempWorktreePath}`);
            await runCmd('git', ['worktree', 'add', '-b', branchName, tempWorktreePath], originalWorkspacePath);
        } catch (e: any) {
            console.error(`[codereview-agent] Failed to create git worktree: ${e.message}`);
            ticketRepository.updateAgentSession(ticket.id, {
                column_id: config.column_id,
                agent_type: 'code_review',
                status: 'blocked',
                error_message: e.message
            });
            return;
        }

        try {
            const session = await opencodeClient.session.create({
                body: { title: `Code Review for Ticket: ${ticket.title}` },
                query: { directory: tempWorktreePath }
            });

            if (!session.data) throw new Error("Failed to create OpenCode session");

            const sessionID = session.data.id;
            activeSessions[ticket.id] = sessionID;

            const encodedPath = Buffer.from(tempWorktreePath).toString('base64url');
            const agentUrl = `http://127.0.0.1:4096/${encodedPath}/session/${sessionID}`;

            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'code_review',
                status: 'processing',
                port: 4096,
                url: agentUrl
            });

            const events = await opencodeClient.event.subscribe();

            // Setup the event listener, telling it this is a 'code_review' agent
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
                branchName,
                'code_review'
            );

            // Wait, we need to pass the GH auth token to the LLM environment so it can execute `gh` commands.
            let ghTokenEnv = '';
            try {
                const { stdout: ghToken } = await runCmd('gh', ['auth', 'token'], originalWorkspacePath);
                if (ghToken.trim()) {
                    ghTokenEnv = `export GH_TOKEN=${ghToken.trim()}; `;
                }
            } catch (authErr) {
                console.warn(`[codereview-agent] Could not fetch GH token:`, authErr);
            }

            const promptRes = await opencodeClient.session.promptAsync({
                path: { id: sessionID },
                body: {
                    parts: [{
                        type: "text",
                        text: `# TASK: Code Review for "${ticket.title}"\n\nThe Pull Request to review is located at: ${prUrl}\n\n## Instructions\n1. Download the diff using \`${ghTokenEnv}gh pr diff ${prUrl}\`.\n2. Analyze the changes for bugs, security issues, best practices, and edge cases.\n3. If the code looks good, leave a comment using \`${ghTokenEnv}gh pr comment ${prUrl} -b "LGTM! [APPROVED]"\`.\n4. If changes are needed, explicitly request changes using \`${ghTokenEnv}gh pr comment ${prUrl} -b "<reason> [CHANGES_REQUESTED]"\`.\n5. Summarize your review directly in this chat.`
                    }]
                }
            });

            if (promptRes.error) {
                throw new Error(`OpenCode session error: ${JSON.stringify(promptRes.error)}`);
            }

        } catch (e: any) {
            console.error(`[codereview-agent] Failed to initialize task over SDK: ${e.message}`);
            delete activeSessions[ticket.id];

            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'code_review',
                status: 'blocked',
                error_message: e.message
            });
        }
    }
}
