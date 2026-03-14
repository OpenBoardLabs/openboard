import { spawn } from 'child_process';
import type { Agent } from './agent.interface.js';
import type { Ticket, ColumnConfig } from '../types.js';
import { ticketRepository } from '../repositories/ticket.repository.js';
import { boardRepository } from '../repositories/board.repository.js';
import { commentRepository } from '../repositories/comment.repository.js';
import { runCmd, normalizePathForOS } from '../utils/os.js';
import { agentQueue } from './agent-queue.js';
import { processRegistry } from '../utils/process-registry.js';

const APPROVED = '[APPROVED]';
const CHANGES_REQUESTED = '[CHANGES_REQUESTED]';
const maxCommentLength = 32000;

/**
 * Cursor-based code review agent: runs the Cursor Agent CLI with a review prompt.
 * Parses output for [APPROVED] or [CHANGES_REQUESTED] to move the ticket.
 */
export class CursorCodeReviewAgent implements Agent {
    async run(ticket: Ticket, config: ColumnConfig): Promise<void> {
        console.log(`[cursor-codereview-agent] Starting session for ticket ${ticket.id}...`);

        const latestTicket = ticketRepository.findById(ticket.id) || ticket;
        const prUrlSession = [...(latestTicket.agent_sessions || [])].reverse().find((s) => s.pr_url);
        const prUrl = prUrlSession?.pr_url;
        const worktreeSession = [...(latestTicket.agent_sessions || [])].reverse().find((s) => s.worktree_path);
        const worktreePath = worktreeSession?.worktree_path;

        if (!prUrl && !worktreePath) {
            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'cursor',
                status: 'blocked',
                error_message: 'No PR or worktree found to review. Make sure a coder agent runs first.',
            });
            commentRepository.create({
                ticketId: ticket.id,
                author: 'cursor',
                content: `❌ **Code Review Failed**\n\nCould not find a Pull Request or worktree to review. Did the developer agent create one?`,
            });
            return;
        }

        const board = boardRepository.findById(ticket.board_id);
        const workspacePath = normalizePathForOS(board?.path || process.cwd());
        const isLocalReview = !prUrl && worktreePath;
        const cwd = isLocalReview ? worktreePath! : workspacePath;

        ticketRepository.updateAgentSession(ticket.id, {
            column_id: ticket.column_id,
            agent_type: 'cursor',
            status: 'processing',
            worktree_path: worktreePath ?? undefined,
        });

        const ticketComments = commentRepository.findByTicketId(ticket.id);
        const commentsContext =
            ticketComments.length > 0
                ? `## Ticket Comments\n\n${ticketComments.map((c) => `- **${c.author}**: ${c.content}`).join('\n')}\n\n`
                : '';

        let ghTokenEnv = '';
        try {
            const { stdout: ghToken } = await runCmd('gh', ['auth', 'token'], workspacePath, 'cursor-codereview-agent');
            if (ghToken?.trim()) ghTokenEnv = `export GH_TOKEN=${ghToken.trim()}; `;
        } catch {
            // ignore
        }

        const promptText = isLocalReview
            ? `# TASK: Code Review for "${ticket.title}"\n\n${commentsContext}A local worktree review. Changes at: ${worktreePath}\n\n## Instructions
1. Run \`git diff HEAD~1 HEAD\` in ${worktreePath} to see changes.
2. Analyze for bugs, security issues, best practices.
3. Your output MUST include either \`[APPROVED]\` (if good) or \`[CHANGES_REQUESTED]\` (if updates needed) so the ticket can be moved automatically.`
            : `# TASK: Code Review for "${ticket.title}"\n\n${commentsContext}Review PR: ${prUrl}\n\n## Instructions
1. Run \`${ghTokenEnv}gh pr diff ${prUrl}\` to get the diff.
2. Analyze for bugs, security issues, best practices.
3. If good: \`${ghTokenEnv}gh pr comment ${prUrl} -b "LGTM! [APPROVED]"\`
4. If changes needed: \`${ghTokenEnv}gh pr comment ${prUrl} -b "<reason> [CHANGES_REQUESTED]"\`
5. Your output MUST include \`[APPROVED]\` or \`[CHANGES_REQUESTED]\` so the ticket can be moved.`;

        const outputChunks: Buffer[] = [];
        const child = spawn('agent', ['--yolo', '-p', promptText], {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
        });
        processRegistry.register(ticket.id, child);

        child.on('error', (err: NodeJS.ErrnoException) => {
            console.warn(`[cursor-codereview-agent] Could not launch agent: ${err.message}`);
            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'cursor',
                status: 'blocked',
                worktree_path: worktreePath ?? undefined,
                error_message: `Agent CLI not found: ${err.message}`,
            });
        });

        child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
            const exitInfo = code !== null ? `exit code ${code}` : `signal ${signal}`;
            console.log(`[cursor-codereview-agent] Agent finished for ticket ${ticket.id} (${exitInfo}).`);

            const wasAborted = signal === 'SIGTERM' || signal === 'SIGINT';
            if (wasAborted) {
                agentQueue.evaluateColumnQueue(ticket.column_id);
                return;
            }

            const rawOutput = Buffer.concat(outputChunks).toString('utf8').trim();
            const truncated = rawOutput.length > maxCommentLength;
            const outputForComment = truncated
                ? rawOutput.slice(0, maxCommentLength) + `\n\n… (truncated, ${rawOutput.length - maxCommentLength} more chars)`
                : rawOutput;
            if (outputForComment) {
                commentRepository.create({
                    ticketId: ticket.id,
                    author: 'cursor',
                    content: `📋 **Review output** (${exitInfo})\n\n${outputForComment}`,
                });
            }

            const upper = rawOutput.toUpperCase();
            const approved = upper.includes(APPROVED);
            const changesRequested = upper.includes(CHANGES_REQUESTED);

            const success = code === 0;
            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'cursor',
                status: success ? 'done' : 'blocked',
                worktree_path: worktreePath ?? undefined,
                ...(success ? {} : { error_message: `Agent exited with ${exitInfo}` }),
            });

            if (success) {
                if (approved && config.on_finish_column_id) {
                    const moved = ticketRepository.move(ticket.id, config.on_finish_column_id, 0);
                    if (moved) {
                        console.log(`[cursor-codereview-agent] Approved: moved ticket ${ticket.id} to ${config.on_finish_column_id}.`);
                        agentQueue.evaluateColumnQueue(config.on_finish_column_id);
                    }
                } else if (changesRequested && config.on_reject_column_id) {
                    const moved = ticketRepository.move(ticket.id, config.on_reject_column_id, 0);
                    if (moved) {
                        console.log(`[cursor-codereview-agent] Changes requested: moved ticket ${ticket.id} to ${config.on_reject_column_id}.`);
                        agentQueue.evaluateColumnQueue(config.on_reject_column_id);
                    }
                }
            }

            agentQueue.evaluateColumnQueue(ticket.column_id);
        });

        child.stdout?.on('data', (data: Buffer) => {
            outputChunks.push(data);
            process.stdout.write(`[cursor-codereview-agent ${ticket.id}] ${data}`);
        });
        child.stderr?.on('data', (data: Buffer) => {
            outputChunks.push(data);
            process.stderr.write(`[cursor-codereview-agent ${ticket.id}] ${data}`);
        });
        child.unref();

        commentRepository.create({
            ticketId: ticket.id,
            author: 'cursor',
            content: `🔍 **Cursor review started**\n\nReviewing ${isLocalReview ? `worktree: \`${worktreePath}\`` : `PR: ${prUrl}`}.`,
        });

        console.log(`[cursor-codereview-agent] Session started for ticket ${ticket.id}.`);
    }
}
