import { createOpencodeClient } from '@opencode-ai/sdk';
import type { Agent } from './agent.interface.js';
import type { Ticket, ColumnConfig } from '../types.js';
import { ticketRepository } from '../repositories/ticket.repository.js';
import { boardRepository } from '../repositories/board.repository.js';
import { commentRepository } from '../repositories/comment.repository.js';
import { setupOpencodeEventListener } from './opencode.events.js';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Helper function to execute commands robustly on Windows
async function runCmd(cmd: string, args: string[], cwd: string): Promise<{ stdout: string, stderr: string }> {
    console.log(`[codereview-agent] Running: ${cmd} ${args.join(' ')} in cwd: ${cwd}`);
    try {
        return await execFileAsync(cmd, args, { cwd });
    } catch (e: any) {
        if (e.code === 'ENOENT') {
            console.log(`[codereview-agent] ENOENT finding binary. Trying fallback exec...`);
            return await execAsync(`${cmd} ${args.join(' ')}`, { cwd });
        }
        throw e;
    }
}

const opencodePort = process.env.OPENCODE_PORT || 4096;
const opencodeClient = createOpencodeClient({ baseUrl: `http://127.0.0.1:${opencodePort}` });
const activeSessions: Record<string, string> = {};

export class CodeReviewAgent implements Agent {
    async run(ticket: Ticket, config: ColumnConfig): Promise<void> {
        console.log(`[codereview-agent] Starting session for ticket ${ticket.id}...`);

        // Fetch the absolute latest ticket from the DB to ensure we have the latest session history (with PR URLs)
        const latestTicket = ticketRepository.findById(ticket.id) || ticket;

        // Find the PR URL from a previous session
        const prUrlSession = [...(latestTicket.agent_sessions || [])].reverse().find(s => s.pr_url);
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
            port: Number(opencodePort)
        });

        if (activeSessions[ticket.id]) {
            try {
                await (opencodeClient.session as any).abort({ path: { id: activeSessions[ticket.id] } });
            } catch (e) {
                console.error(`[codereview-agent] Error aborting previous session:`, e);
            }
            delete activeSessions[ticket.id];
        }

        // Resolve workspace path — code review runs in the main workspace (no new worktree needed).
        let workspacePath = process.cwd();

        try {
            const session = await opencodeClient.session.create({
                body: { title: `Code Review for Ticket: ${ticket.title}` },
                query: { directory: workspacePath }
            });

            if (!session.data) throw new Error("Failed to create OpenCode session");

            const sessionID = session.data.id;
            activeSessions[ticket.id] = sessionID;

            const encodedPath = Buffer.from(workspacePath).toString('base64url');
            const agentUrl = `http://127.0.0.1:${opencodePort}/${encodedPath}/session/${sessionID}`;

            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'code_review',
                status: 'processing',
                port: Number(opencodePort),
                url: agentUrl
            });

            const events = await opencodeClient.event.subscribe();

            // Setup the event listener for code_review agent type.
            // worktreePath = workspacePath (main workspace) — used for gh commands inside the event handler.
            setupOpencodeEventListener(
                events,
                opencodeClient,
                sessionID,
                ticket,
                agentUrl,
                config,
                activeSessions,
                workspacePath,   // worktreePath — main workspace for gh commands
                workspacePath,   // originalWorkspacePath — same here, no separate worktree
                '',              // branchName — no branch created for code review
                'code_review'
            );

            // Fetch GH token so the LLM environment can execute `gh` commands
            let ghTokenEnv = '';
            try {
                const { stdout: ghToken } = await runCmd('gh', ['auth', 'token'], workspacePath);
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

            console.log(`[codereview-agent] Code review agent dispatched for ticket ${ticket.id}. Waiting for completion in background.`);

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
