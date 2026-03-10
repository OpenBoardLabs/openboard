import { ticketRepository } from '../repositories/ticket.repository.js';
import { columnConfigRepository } from '../repositories/column-config.repository.js';
import { sseManager } from '../sse.js';
import { DummyAgent } from './dummy.agent.js';
import { OpencodeAgent } from './opencode.agent.js';
import type { Agent } from './agent.interface.js';
import type { AgentType, Ticket, Priority } from '../types.js';

const agentRegistry: Partial<Record<AgentType, new () => Agent>> = {
    dummy: DummyAgent,
    opencode: OpencodeAgent,
};

const PRIORITY_WEIGHTS: Record<Priority, number> = {
    urgent: 4,
    high: 3,
    medium: 2,
    low: 1,
};

class AgentQueueManager {
    // Ticket IDs currently running (to prevent same ticket starting twice)
    private runningTickets: Set<string> = new Set();

    // Map to prevent concurrent evaluation of the same column
    private evaluatingColumns: Set<string> = new Set();

    /**
     * Enqueue a ticket for processing. 
     * In the new design, we just evaluate the column it belongs to.
     */
    async enqueue(ticketId: string, force: boolean = false) {
        const ticket = ticketRepository.findById(ticketId);
        if (ticket) {
            if (force) {
                // Remove the blocked session if it exists for this column so it can be picked up freshly
                const updatedSessions = ticket.agent_sessions.filter(s => !(s.column_id === ticket.column_id && s.status === 'blocked'));
                // Directly overwrite the JSON via raw DB call to avoid deep partial matching issues
                const dbModule = await import('../db/database.js');
                dbModule.getDb().prepare('UPDATE tickets SET agent_sessions = ? WHERE id = ?').run(JSON.stringify(updatedSessions), ticketId);
                // Also update the local ticket reference so evaluateColumnQueue sees it immediately
                ticket.agent_sessions = updatedSessions;
            }
            this.evaluateColumnQueue(ticket.column_id);
        }
    }

    /**
     * Trigger a global evaluation (e.g. on startup or general pings).
     * Ideally, we use evaluateColumnQueue for specific events.
     */
    async ping() {
        // Iterate all active columns and evaluate them
        // For simplicity now, we'll just not do a global ping unless needed, 
        // as the system is reactive per-column now. 
        // But to keep API stable, let's look up all tickets and find unique columns config'd for agents.
        const dbModule = await import('../db/database.js');
        const db = dbModule.getDb();
        const activeCols = db.prepare("SELECT column_id FROM column_configs WHERE agent_type != 'none'").all() as { column_id: string }[];
        for (const col of activeCols) {
            this.evaluateColumnQueue(col.column_id);
        }
    }

    /**
     * Evaluate a specific column and dispatch agents if slots are available.
     */
    async evaluateColumnQueue(columnId: string) {
        if (this.evaluatingColumns.has(columnId)) return;
        this.evaluatingColumns.add(columnId);

        try {
            const config = columnConfigRepository.findByColumnId(columnId);
            if (!config || config.agent_type === 'none') return;

            const maxAgents = config.max_agents ?? 1;
            const tickets = ticketRepository.findByColumnId(columnId);

            // Find how many currently running active sessions this column has
            let activeCount = 0;
            const eligibleTickets: Ticket[] = [];

            for (const ticket of tickets) {
                // Find the session for THIS specific column
                const session = ticket.agent_sessions.find(s => s.column_id === columnId);

                if (session) {
                    if (session.status === 'processing' || session.status === 'needs_approval' || this.runningTickets.has(ticket.id)) {
                        activeCount++;
                    } else if (session.status === 'done') {
                        // Already completed this step, skip it completely.
                        continue;
                    } else if (session.status === 'blocked') {
                        // Blocked tickets stay blocked until manually retried. Skip for auto-queue.
                        continue;
                    }
                } else {
                    // No session yet means it hasn't started in this column!
                    eligibleTickets.push(ticket);
                }
            }

            if (activeCount >= maxAgents) {
                // At concurrency limit.
                return;
            }

            // Sort eligible: highest priority first, then oldest created_at first
            eligibleTickets.sort((a, b) => {
                const weightA = PRIORITY_WEIGHTS[a.priority] ?? 2;
                const weightB = PRIORITY_WEIGHTS[b.priority] ?? 2;
                if (weightA !== weightB) {
                    return weightB - weightA; // Descending priority
                }
                return new Date(a.created_at).getTime() - new Date(b.created_at).getTime(); // Ascending date
            });

            // Dispatch agents for top eligible tickets up to the remaining slots
            const slotsAvailable = maxAgents - activeCount;
            const toDispatch = eligibleTickets.slice(0, slotsAvailable);

            for (const ticket of toDispatch) {
                this.runningTickets.add(ticket.id);

                this.dispatchAgent(ticket, config as any).catch(err => {
                    console.error(`[agent-queue] Failed to dispatch agent for ticket ${ticket.id}`, err);
                }).finally(() => {
                    this.runningTickets.delete(ticket.id);
                    // Re-evaluate when slot frees up
                    this.evaluateColumnQueue(columnId);
                });
            }

        } finally {
            this.evaluatingColumns.delete(columnId);
        }
    }

    private async dispatchAgent(ticket: Ticket, config: { agent_type: AgentType; agent_model?: string | null; on_finish_column_id?: string | null }) {
        console.log(`[agent-queue] Dispatching agent ${config.agent_type} for ticket ${ticket.id} in column ${ticket.column_id} (Priority: ${ticket.priority})`);

        // Set processing status before starting via updateAgentSession
        ticketRepository.updateAgentSession(ticket.id, {
            column_id: ticket.column_id,
            agent_type: config.agent_type,
            status: 'processing'
        });

        const AgentClass = agentRegistry[config.agent_type];
        if (!AgentClass) {
            console.warn(`[agent-queue] Unknown agent type: ${config.agent_type}`);
            return;
        }

        const agent = new AgentClass();
        try {
            await agent.run(ticket, config as any);
        } catch (err) {
            console.error(`[agent-queue] Error executing agent ${config.agent_type} on ticket ${ticket.id}:`, err);

            // Mark as blocked on execution failure safely
            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: config.agent_type,
                status: 'blocked',
                error_message: err instanceof Error ? err.message : String(err)
            });

            // Optionally, we could set agent_status to 'error' or 'blocked' here if agent.run didn't manage to handle the error properly.
            // Oh wait, we already did via updateAgentSession! Great!
        }
    }
}

export const agentQueue = new AgentQueueManager();
