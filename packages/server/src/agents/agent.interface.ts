import type { Ticket, ColumnConfig } from '../types.js';

/** Every agent implementation must satisfy this interface. */
export interface Agent {
    /**
     * Execute the agent's work for the given ticket.
     * Called once when a ticket arrives in a configured column.
     */
    run(ticket: Ticket, config: ColumnConfig): Promise<void>;
}
