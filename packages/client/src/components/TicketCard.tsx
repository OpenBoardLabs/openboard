import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Ticket } from '../types';
import { PriorityBadge } from './PriorityBadge';
import styles from './TicketCard.module.css';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bot, CheckCircle, ExternalLink } from 'lucide-react';
import { t } from '../i18n/i18n';

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

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`${styles.card} ${isDragging ? styles.dragging : ''}`}
            {...attributes}
            {...listeners}
            onClick={() => navigate(`/boards/${boardId}/tickets/${ticket.id}`)}
        >
            <p className={styles.title}>{ticket.title}</p>
            {ticket.description && (
                <p className={styles.description}>{ticket.description}</p>
            )}
            <div className={styles.footer}>
                <div className={styles.left}>
                    <PriorityBadge priority={ticket.priority} />
                    {ticket.agent_sessions?.map(session => {
                        if (session.column_id !== ticket.column_id) return null;
                        if (!session.url && session.status !== 'processing' && session.status !== 'done' && session.status !== 'blocked') return null;

                        return (
                            <a
                                key={session.column_id}
                                href={session.url || `http://127.0.0.1:${session.port || 4096}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`${styles.inspectBtn} ${session.status === 'processing' ? styles.processingBtn :
                                    session.status === 'done' ? styles.doneBtn :
                                        session.status === 'blocked' ? styles.blockedBtn : ''
                                    }`}
                                title={session.url ? "Inspect Agent Session" : "Open Agent UI"}
                                onClick={(e) => e.stopPropagation()}
                            >
                                {session.status === 'done' ? <CheckCircle size={14} className={styles.doneIcon} /> :
                                    session.status === 'blocked' ? <span style={{ color: 'red' }}>⚠️</span> :
                                        <Bot size={14} className={session.status === 'processing' ? styles.processingIcon : ''} />}
                                <span>
                                    {session.status === 'blocked' ? 'Error' :
                                        session.status === 'done' ? 'Done' :
                                            session.status === 'processing' ? t('agent.status.processing' as any) || 'Processing' :
                                                'Agent UI'}
                                </span>
                                <ExternalLink size={12} />
                            </a>
                        );
                    })}
                </div>

            </div>
        </div>
    );
}
