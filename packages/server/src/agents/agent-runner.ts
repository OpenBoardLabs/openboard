import type { Ticket } from '../types.js';
import { columnConfigRepository } from '../repositories/column-config.repository.js';
import { agentQueue } from './agent-queue.js';


/**
 * Checks whether the column the ticket just arrived in has an agent configured,
 * and if so, spawns the agent to run asynchronously (fire-and-forget).
 */
export function triggerAgent(ticket: Ticket, force: boolean = false): void {
    const config = columnConfigRepository.findByColumnId(ticket.column_id);
    if (!config || config.agent_type === 'none') {
        // Even if the new column doesn't have an agent, this ticket might have moved
        // OUT of a column that DOES have an agent, freeing up a concurrency slot.
        // Therefore we must ping the queue to evaluate.
        agentQueue.ping();
        return;
    }

    console.log(`[agent-runner] Enqueuing ticket ${ticket.id} for agent ${config.agent_type} (Priority: ${ticket.priority})`);
    agentQueue.enqueue(ticket.id, force);
}
