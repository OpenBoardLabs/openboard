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

const opencodePort = process.env.OPENCODE_PORT || 4096;
const activeSessions: Record<string, string> = {};

export class CodeReviewAgent implements Agent {
    async run(ticket: Ticket, config: ColumnConfig): Promise<void> {
        console.log(`[codereview-agent] Starting session for ticket ${ticket.id}...`);

        // Find an available port for this session early
        const dynamicPort = await findFreePort(Number(opencodePort));
        console.log(`[codereview-agent] Selected port ${dynamicPort} for ticket ${ticket.id}`);

        // Fetch the absolute latest ticket from the DB to ensure we have the latest session history (with PR URLs)
        const latestTicket = ticketRepository.findById(ticket.id) || ticket;

        // Find the PR URL from a previous session
        const prUrlSession = [...(latestTicket.agent_sessions || [])].reverse().find(s => s.pr_url);
        const prUrl = prUrlSession?.pr_url;

        // Find worktree path from previous sessions (if PR not available)
        const worktreeSession = [...(latestTicket.agent_sessions || [])].reverse().find(s => s.worktree_path);
        const worktreePath = worktreeSession?.worktree_path;

        if (!prUrl && !worktreePath) {
            console.error(`[codereview-agent] No PR URL or worktree found for ticket ${ticket.id}`);
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

        // Determine if we're doing PR review or local worktree review
        const isLocalReview = !prUrl && worktreePath;
        let reviewSource: string;
        let reviewPath: string;

        if (isLocalReview) {
            reviewSource = 'local worktree';
            reviewPath = worktreePath!;
        } else {
            reviewSource = 'PR';
            reviewPath = prUrl!;
        }

        console.log(`[codereview-agent] Starting ${reviewSource} review for ticket ${ticket.id} at ${reviewPath}`);

        // Create a board-scoped Opencode client for this ticket
        // (Will be re-created later once we have the dynamic port)
        const board = boardRepository.findById(ticket.board_id);

        ticketRepository.updateAgentSession(ticket.id, {
            column_id: ticket.column_id,
            agent_type: 'code_review',
            status: 'processing',
            port: dynamicPort
        });

        // Resolve workspace path — for local review use worktree path, otherwise use main workspace
        let workspacePath = isLocalReview 
            ? normalizePathForOS(worktreePath!) 
            : normalizePathForOS(board?.path || process.cwd());

        // B. Spawn `opencode serve` in the review path
        const serverProcess = spawn('opencode', ['serve', '--port', dynamicPort.toString()], {
            cwd: workspacePath,
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
        const opencodeClient = createBoardScopedClient(workspacePath, dynamicPort);

        if (activeSessions[ticket.id]) {
            try {
                await (opencodeClient.session as any).abort({ path: { id: activeSessions[ticket.id] } });
            } catch (e) {
                console.error(`[codereview-agent] Error aborting previous session:`, e);
            }
            delete activeSessions[ticket.id];
        }

        try {
            const session = await opencodeClient.session.create({
                body: { title: `Code Review for Ticket: ${ticket.title}` },
                query: { directory: workspacePath }
            });

            if (!session.data) throw new Error("Failed to create OpenCode session");

            const sessionID = session.data.id;
            activeSessions[ticket.id] = sessionID;

            const encodedPath = Buffer.from(workspacePath).toString('base64url');
            const agentUrl = `http://127.0.0.1:${dynamicPort}/${encodedPath}/session/${sessionID}`;

            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'code_review',
                status: 'processing',
                port: dynamicPort,
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
                'code_review',
                dynamicPort
            );

            // Fetch GH token so the LLM environment can execute `gh` commands
            let ghTokenEnv = '';
            try {
                const { stdout: ghToken } = await runCmd('gh', ['auth', 'token'], workspacePath, 'codereview-agent');
                if (ghToken.trim()) {
                    ghTokenEnv = `export GH_TOKEN=${ghToken.trim()}; `;
                }
            } catch (authErr) {
                console.warn(`[codereview-agent] Could not fetch GH token:`, authErr);
            }

            const promptText = isLocalReview
                ? `# TASK: Code Review for "${ticket.title}"\n\nA local worktree review will be performed. The changes are located at: ${worktreePath}\n\n## Instructions
1. Run \`git diff HEAD~1 HEAD\` in the worktree directory ${worktreePath} to see what changed.
2. Analyze the changes for bugs, security issues, best practices, and edge cases.
3. Review the code directly in the worktree at ${worktreePath}.
4. Summarize your review directly in this chat. **IMPORTANT: Your summary MUST include either \`[APPROVED]\` (if the changes look good) or \`[CHANGES_REQUESTED]\` (if updates are needed) so that the ticket can be automatically moved.**`
                : `# TASK: Code Review for "${ticket.title}"\n\nThe Pull Request to review is located at: ${prUrl}\n\n## Instructions
1. Download the diff using \`${ghTokenEnv}gh pr diff ${prUrl}\`.
2. Analyze the changes for bugs, security issues, best practices, and edge cases.
3. If the code looks good, leave a comment using \`${ghTokenEnv}gh pr comment ${prUrl} -b "LGTM! [APPROVED]"\`.
4. If changes are needed, explicitly request changes using \`${ghTokenEnv}gh pr comment ${prUrl} -b "<reason> [CHANGES_REQUESTED]"\`.
5. Summarize your review directly in this chat. **IMPORTANT: Your summary MUST include either \`[APPROVED]\` or \`[CHANGES_REQUESTED]\` so that the ticket can be automatically moved.**`;

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
