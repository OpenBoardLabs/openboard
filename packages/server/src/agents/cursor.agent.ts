import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import type { Agent } from './agent.interface.js';
import type { Ticket, ColumnConfig } from '../types.js';
import { ticketRepository } from '../repositories/ticket.repository.js';
import { boardRepository } from '../repositories/board.repository.js';
import { commentRepository } from '../repositories/comment.repository.js';
import { ensureWorktree } from '../utils/worktree.js';
import { normalizePathForOS } from '../utils/os.js';
import { agentQueue } from './agent-queue.js';
import { processRegistry } from '../utils/process-registry.js';

const TASK_FILENAME = 'TASK.md';

/**
 * Build the full prompt for the Cursor Agent CLI, including comments and code review context.
 */
function buildAgentPrompt(
    ticket: Ticket,
    worktreePath: string,
    existingPrUrl: string | null
): string {
    let prompt = `# TASK: ${ticket.title}

## Description

${ticket.description}

## Instructions

1. The current working directory is ${worktreePath}. Work in this folder to complete the task.
`;

    if (existingPrUrl) {
        prompt += `
⚠️ **ATTENTION: CHANGES REQUESTED** ⚠️

You previously worked on this ticket and opened PR ${existingPrUrl}. However, changes were requested during code review.

Please run \`gh pr view ${existingPrUrl} --comments\` to read the requested changes, make the necessary code updates to fix the issues, and summarize your fixes.
`;
    }

    const comments = commentRepository.findByTicketId(ticket.id);
    if (comments.length > 0) {
        prompt += `

## Comments from the ticket

${comments.map((c) => `**${c.author}**: ${c.content}`).join('\n\n')}
`;
    }

    prompt += `

---
When done, the ticket will be moved to the next column on the board. Complete all work in this directory.
`;

    return prompt;
}


/**
 * Cursor coder agent: creates a worktree, runs the Cursor Agent CLI (`agent -p`) with the task.
 * No IDE opens; the agent runs headless in the terminal.
 */
export class CursorAgent implements Agent {
    async run(ticket: Ticket, config: ColumnConfig): Promise<void> {
        console.log(`[cursor-agent] Starting session for ticket ${ticket.id}...`);

        const board = boardRepository.findById(ticket.board_id);
        const workspacePath = normalizePathForOS(board?.path || process.cwd());

        const latestTicket = ticketRepository.findById(ticket.id) || ticket;
        const previousPrSession = [...(latestTicket.agent_sessions || [])].reverse().find((s) => s.pr_url);
        const existingPrUrl = previousPrSession?.pr_url ?? null;

        let worktreePath: string;
        try {
            const result = await ensureWorktree({
                workspacePath,
                ticketId: ticket.id,
                existingPrUrl,
                logLabel: 'cursor-agent',
            });
            worktreePath = result.worktreePath;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.error(`[cursor-agent] Failed to create worktree: ${message}`);
            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'cursor',
                status: 'blocked',
                worktree_path: undefined,
                error_message: message,
            });
            commentRepository.create({
                ticketId: ticket.id,
                author: 'cursor',
                content: `❌ **Failed to create worktree**\n\n${message}`,
            });
            return;
        }

        // Write TASK.md for reference
        const comments = await commentRepository.findByTicketId(ticket.id);
        const commentsBlock =
            comments.length > 0
                ? `\n\n## Comments\n\n${comments.map((c) => `**${c.author}**: ${c.content}`).join('\n\n')}`
                : '';
        const taskContent = `# ${ticket.title}

## Description

${ticket.description}
${commentsBlock}

---
*OpenBoard ticket · Cursor Agent is running on this task. When done, move the ticket to the next column.*
`;
        try {
            fs.writeFileSync(path.join(worktreePath, TASK_FILENAME), taskContent, 'utf8');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[cursor-agent] Could not write ${TASK_FILENAME}: ${msg}`);
        }

        // Update session so UI shows worktree
        ticketRepository.updateAgentSession(ticket.id, {
            column_id: ticket.column_id,
            agent_type: 'cursor',
            status: 'processing',
            worktree_path: worktreePath,
        });

        // Build prompt with comments and code review context
        const promptText = buildAgentPrompt(ticket, worktreePath, existingPrUrl);

        // Run Cursor Agent CLI in the worktree (headless, no IDE)
        const child = spawn('agent', ['--yolo', '-p', promptText], {
            cwd: worktreePath,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
        });
        processRegistry.register(ticket.id, child);
        child.on('error', (err: NodeJS.ErrnoException) => {
            console.warn(`[cursor-agent] Could not launch agent (install: curl https://cursor.com/install -fsS | bash): ${err.message}`);
            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'cursor',
                status: 'blocked',
                worktree_path: worktreePath,
                error_message: `Agent CLI not found: ${err.message}. Install with: curl https://cursor.com/install -fsS | bash`,
            });
        });
        const outputChunks: Buffer[] = [];
        const appendOutput = (data: Buffer, stream: 'stdout' | 'stderr') => {
            outputChunks.push(data);
            const dest = stream === 'stdout' ? process.stdout : process.stderr;
            dest.write(`[cursor-agent ${ticket.id}] ${data}`);
        };

        child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
            const exitInfo = code !== null ? `exit code ${code}` : `signal ${signal}`;
            console.log(`[cursor-agent] Agent finished for ticket ${ticket.id} (${exitInfo}).`);

            const wasAborted = signal === 'SIGTERM' || signal === 'SIGINT';
            if (wasAborted) {
                agentQueue.evaluateColumnQueue(ticket.column_id);
                return;
            }

            const rawOutput = Buffer.concat(outputChunks).toString('utf8').trim();
            const maxCommentLength = 32000;
            const truncated = rawOutput.length > maxCommentLength;
            const outputForComment = truncated ? rawOutput.slice(0, maxCommentLength) + `\n\n… (truncated, ${rawOutput.length - maxCommentLength} more chars)` : rawOutput;
            if (outputForComment) {
                commentRepository.create({
                    ticketId: ticket.id,
                    author: 'cursor',
                    content: `📋 **Agent output** (${exitInfo})\n\n${outputForComment}`,
                });
            }

            const success = code === 0;
            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'cursor',
                status: success ? 'done' : 'blocked',
                worktree_path: worktreePath,
                ...(success ? {} : { error_message: `Agent exited with ${exitInfo}` }),
            });

            if (success && config.on_finish_column_id) {
                const moved = ticketRepository.move(ticket.id, config.on_finish_column_id, 0);
                if (moved) {
                    console.log(`[cursor-agent] Moved ticket ${ticket.id} to column ${config.on_finish_column_id}.`);
                    agentQueue.evaluateColumnQueue(config.on_finish_column_id);
                }
            }

            agentQueue.evaluateColumnQueue(ticket.column_id);
        });
        child.stdout?.on('data', (data: Buffer) => appendOutput(data, 'stdout'));
        child.stderr?.on('data', (data: Buffer) => appendOutput(data, 'stderr'));
        child.unref();

        commentRepository.create({
            ticketId: ticket.id,
            author: 'cursor',
            content: `🤖 **Cursor Agent started**\n\nWorktree: \`${worktreePath}\`\n\nThe agent is running. When it finishes, the ticket will be moved to the next column automatically (if configured).`,
        });

        console.log(`[cursor-agent] Session started for ticket ${ticket.id}; agent running in ${worktreePath}.`);
    }
}
