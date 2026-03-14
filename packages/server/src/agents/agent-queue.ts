import { ticketRepository } from '../repositories/ticket.repository.js';
import { columnConfigRepository } from '../repositories/column-config.repository.js';
import type { Agent } from './agent.interface.js';
import type { AgentType, Ticket, Priority } from '../types.js';

// Agents are lazy-loaded inside dispatchAgent() to avoid circular ESM imports
// (agent files import opencode.events.ts which imports agentQueue from here)
async function resolveAgentClass(agentType: AgentType): Promise<(new () => Agent) | undefined> {
    switch (agentType) {
        case 'opencode': return (await import('./opencode.agent.js')).OpencodeAgent;
        case 'code_review': return (await import('./codereview.agent.js')).CodeReviewAgent;
        default: return undefined;
    }
}

const PRIORITY_WEIGHTS: Record<Priority, number> = {
    urgent: 4,
    high: 3,
    medium: 2,
    low: 1,
};

class AgentQueueManager {
    // Ticket IDs currently running (to prevent same ticket starting twice)
    public runningTickets: Set<string> = new Set();

    // Map to prevent concurrent evaluation of the same column
    private evaluatingColumns: Set<string> = new Set();

    // Tickets explicitly forced to re-run even if their last session is 'done'
    private forcedTickets: Set<string> = new Set();

    /**
     * Enqueue a ticket for processing. 
     * In the new design, we just evaluate the column it belongs to.
     */
    async enqueue(ticketId: string, force: boolean = false) {
        const ticket = ticketRepository.findById(ticketId);
        if (ticket) {
            if (force) {
                // Mark this ticket as forced so evaluateColumnQueue bypasses the 'done' skip
                this.forcedTickets.add(ticketId);
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
                // Skip if already running in memory
                if (this.runningTickets.has(ticket.id)) {
                    activeCount++;
                    continue;
                }

                // Look at the LAST session in the ENTIRE history array.
                // - If no sessions: ticket is fresh → eligible
                // - If ticket has column_moves: it was moved to another column and back → eligible
                // - If last session is for THIS column:
                //     done → finished here naturally, skip
                //     blocked → skip unless forced (retry path)
                const lastSession = ticket.agent_sessions.length > 0
                    ? ticket.agent_sessions[ticket.agent_sessions.length - 1]
                    : null;

                const hasActiveSession = ticket.agent_sessions.some(
                    s => s.status === 'processing' || s.status === 'needs_approval'
                );

                if (hasActiveSession) {
                    activeCount++;
                    continue;
                }

                const wasInAnotherColumn = ticket.column_moves.length > 0;

                if (!lastSession) {
                    eligibleTickets.push(ticket);
                } else if (wasInAnotherColumn) {
                    eligibleTickets.push(ticket);
                } else {
                    if (lastSession.status === 'done') {
                        if (this.forcedTickets.has(ticket.id)) {
                            eligibleTickets.push(ticket);
                        }
                    } else if (lastSession.status === 'blocked') {
                        if (this.forcedTickets.has(ticket.id)) {
                            eligibleTickets.push(ticket);
                        }
                    }
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
                this.forcedTickets.delete(ticket.id); // Clear forced flag before dispatching
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

    private async dispatchAgent(ticket: Ticket, config: { agent_type: AgentType; on_finish_column_id?: string | null }) {
        console.log(`[agent-queue] Dispatching agent ${config.agent_type} for ticket ${ticket.id} in column ${ticket.column_id} (Priority: ${ticket.priority})`);

        // Agents own setting their own 'processing' status at the start of run()
        const AgentClass = await resolveAgentClass(config.agent_type);
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
