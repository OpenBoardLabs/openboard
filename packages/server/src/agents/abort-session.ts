import { ticketRepository } from '../repositories/ticket.repository.js';
import { processRegistry } from '../utils/process-registry.js';
import { commentRepository } from '../repositories/comment.repository.js';
import { activeSessions } from './active-sessions.js';
import { agentQueue } from './agent-queue.js';

export function abortSession(ticketId: string): void {
    const ticket = ticketRepository.findById(ticketId);
    if (!ticket) return;

    const activeAgentSessions = ticket.agent_sessions.filter(
        s => s.status === 'processing' || s.status === 'needs_approval'
    );

    for (const session of activeAgentSessions) {
        console.log(`[abort-session] Aborting ${session.agent_type} session for ticket ${ticketId} (session in column ${session.column_id})`);

        processRegistry.kill(ticketId);
        delete activeSessions[ticketId];
        agentQueue.runningTickets.delete(ticketId);

        ticketRepository.updateAgentSession(ticketId, {
            column_id: session.column_id,
            agent_type: session.agent_type,
            status: 'blocked',
            error_message: 'Session aborted: ticket moved to another column'
        });

        commentRepository.create({
            ticketId: ticketId,
            author: 'system',
            content: `⚠️ **Session Aborted**\n\nThe ${session.agent_type} agent session was aborted because the ticket was moved to another column.`
        });
    }

    agentQueue.ping();
}
