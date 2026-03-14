import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Ticket } from '../types';
import { PriorityBadge } from './PriorityBadge';
import styles from './TicketCard.module.css';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CheckCircle, ExternalLink, GitPullRequest, Copy } from 'lucide-react';
import { getAgentConfig } from '../constants/agents';

interface TicketCardProps {
    ticket: Ticket;
    isOverlay?: boolean;
}

export function TicketCard({ ticket, isOverlay }: TicketCardProps) {
    const navigate = useNavigate();
    const { boardId } = useParams();

    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: ticket.id,
        data: { type: 'ticket', ticket },
        disabled: isOverlay,
    });

    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging && !isOverlay ? 0.3 : 1,
        cursor: 'grab',
    };

    const activeColumnSession = [...(ticket.agent_sessions ?? [])].reverse().find(s => s.column_id === ticket.column_id);
    const hasNeedsApproval = activeColumnSession?.status === 'needs_approval';

    // Find the most recent session with a PR URL anywhere
    const prSession = [...(ticket.agent_sessions ?? [])].reverse().find(s => s.pr_url);

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`${styles.card} ${isDragging ? styles.dragging : ''} ${hasNeedsApproval ? styles.needsApprovalCard : ''}`}
            {...attributes}
            {...listeners}
            onClick={() => navigate(`/boards/${boardId}/tickets/${ticket.id}`)}
        >
            {prSession && prSession.pr_url && (
                <a
                    href={prSession.pr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${styles.inspectBtn} ${styles.prButtonOverlay}`}
                    style={{ backgroundColor: '#2da44e', color: 'white', borderColor: '#2da44e' }}
                    title="View Code Review"
                    onClick={(e) => e.stopPropagation()}
                >
                    <GitPullRequest size={14} />
                    <span>PR</span>
                    <ExternalLink size={12} />
                </a>
            )}
            {/* Show worktree button when PR creation failed */}
            {activeColumnSession?.status === 'blocked' && activeColumnSession?.error_message?.includes('PR creation failed') && activeColumnSession?.worktree_path && (
                <button
                    className={`${styles.inspectBtn} ${styles.prButtonOverlay}`}
                    style={{ backgroundColor: '#6e7681', color: 'white', borderColor: '#6e7681' }}
                    title="Copy Worktree Path"
                    onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(activeColumnSession.worktree_path!);
                    }}
                >
                    <Copy size={14} />
                    <span>Worktree</span>
                </button>
            )}
            <p className={`${styles.title} ${prSession ? styles.titleWithPr : ''}`}>{ticket.title}</p>
            {ticket.description && (
                <p className={styles.description}>{ticket.description}</p>
            )}
            <div className={styles.footer}>
                <div className={styles.left}>
                    <PriorityBadge priority={ticket.priority} />
                    {(() => {
                        if (!ticket.agent_sessions || ticket.agent_sessions.length === 0) return null;

                        // Find the most recent session for this specific column
                        let activeSession = null;
                        for (let i = ticket.agent_sessions.length - 1; i >= 0; i--) {
                            if (ticket.agent_sessions[i].column_id === ticket.column_id) {
                                activeSession = ticket.agent_sessions[i];
                                break;
                            }
                        }

                        if (!activeSession) return null;

                        const session = activeSession;
                        const showActiveSession = session && (session.url || session.status === 'processing' || session.status === 'done' || session.status === 'blocked' || session.status === 'needs_approval');

                        if (!showActiveSession) return null;

                        return (
                            <React.Fragment key={(session?.column_id || 'no-col') + '-' + (session?.started_at || 'no-start')}>
                                <a
                                    href={session.url || `http://127.0.0.1:${session.port || 4096}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`${styles.inspectBtn} ${session.status === 'processing' ? styles.processingBtn :
                                        session.status === 'done' ? styles.doneBtn :
                                            session.status === 'blocked' ? styles.blockedBtn :
                                                session.status === 'needs_approval' ? styles.needsApprovalBtn : ''
                                        }`}
                                    title={session.url ? "Inspect Agent Session" : "Open Agent UI"}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {session.status === 'done' ? <CheckCircle size={14} className={styles.doneIcon} /> :
                                        session.status === 'blocked' ? <span style={{ color: 'red' }}>⚠️</span> :
                                            session.status === 'needs_approval' ? <span style={{ color: '#f59e0b', fontSize: '14px', lineHeight: 1 }}>✋</span> :
                                                getAgentConfig(session.agent_type).icon}
                                    <span>
                                        {session.status === 'blocked' ? 'Error' :
                                            session.status === 'done' ? 'Done' :
                                                session.status === 'needs_approval' ? 'Needs Approval' :
                                                    session.status === 'processing' ? getAgentConfig(session.agent_type).processingText :
                                                        'Agent UI'}
                                    </span>
                                    <ExternalLink size={12} />
                                </a>
                            </React.Fragment>
                        );
                    })()}
                </div>

            </div>
        </div>
    );
}
