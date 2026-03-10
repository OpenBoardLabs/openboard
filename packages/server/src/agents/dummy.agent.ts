import type { Agent } from './agent.interface.js';
import type { Ticket, ColumnConfig } from '../types.js';
import { commentRepository } from '../repositories/comment.repository.js';
import { ticketRepository } from '../repositories/ticket.repository.js';
import { sseManager } from '../sse.js';

const DELAY_MS = 10_000;

/**
 * DummyAgent — simulates work by waiting 10 seconds, then:
 *   1. Posts a comment "I finished the task" on the ticket.
 *   2. Emits a `comment:added` SSE event.
 *   3. If `on_finish_column_id` is configured, moves the ticket there
 *      and emits a `ticket:moved` SSE event.
 */
export class DummyAgent implements Agent {
    async run(ticket: Ticket, config: ColumnConfig): Promise<void> {
        console.log(`[dummy-agent] Starting work for ticket ${ticket.id} (will wait 10s)...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));

        // 1 — Post completion comment
        const comment = commentRepository.create({
            ticketId: ticket.id,
            author: 'dummy-agent',
            content: 'I finished the task',
        });
        console.log(`[dummy-agent] Posted comment for ticket ${ticket.id}`);
        sseManager.emit(ticket.board_id, 'comment:added', {
            ticketId: ticket.id,
            comment: comment
        });

        // 2 — Set status to done
        const updated = ticketRepository.updateAgentSession(ticket.id, {
            column_id: ticket.column_id,
            agent_type: 'dummy',
            status: 'done'
        });
        if (updated) {
            sseManager.emit(ticket.board_id, 'ticket:updated', updated);
        }

        // 3 — Move ticket to the configured destination column (if set)
        if (config.on_finish_column_id) {
            console.log(`[dummy-agent] Moving ticket ${ticket.id} to column ${config.on_finish_column_id}`);

            const moved = ticketRepository.move(ticket.id, config.on_finish_column_id, 0);
            if (moved) {
                sseManager.emit(ticket.board_id, 'ticket:moved', moved);
                // Also trigger agent for the NEW column if one is configured there
                const { triggerAgent } = await import('./agent-runner.js');
                triggerAgent(moved);
            }
        }
        console.log(`[dummy-agent] Finished work for ticket ${ticket.id}`);
    }
}
