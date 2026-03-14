import { ticketRepository } from '../repositories/ticket.repository.js';
import { processRegistry } from '../utils/process-registry.js';
import { commentRepository } from '../repositories/comment.repository.js';
import { activeSessions } from './active-sessions.js';
import { agentQueue } from './agent-queue.js';

type AbortReason = 'moved' | 'aborted';

export function abortSession(ticketId: string, reason: AbortReason = 'moved'): void {
    const ticket = ticketRepository.findById(ticketId);
    if (!ticket) return;

    const activeAgentSessions = ticket.agent_sessions.filter(
        s => s.status === 'processing' || s.status === 'needs_approval'
    );

    for (const session of activeAgentSessions) {
        console.log(`[abort-session] Aborting ${session.agent_type} session for ticket ${ticketId} (session in column ${session.column_id}) with reason=${reason}`);

        processRegistry.kill(ticketId);
        delete activeSessions[ticketId];
        agentQueue.runningTickets.delete(ticketId);

        const baseMessage = `⚠️ **Session Aborted**\n\nThe ${session.agent_type} agent session was aborted`;
        const reasonSuffix =
            reason === 'moved'
                ? ' because the ticket was moved to another column.'
                : ' by the user.';

        ticketRepository.updateAgentSession(ticketId, {
            column_id: session.column_id,
            agent_type: session.agent_type,
            status: reason === 'aborted' ? 'aborted' : 'blocked',
            error_message:
                reason === 'moved'
                    ? 'Session aborted: ticket moved to another column'
                    : 'Session aborted: aborted by user',
        });

        commentRepository.create({
            ticketId: ticketId,
            author: 'system',
            content: `${baseMessage}${reasonSuffix}`,
        });
    }

    agentQueue.ping();
}
