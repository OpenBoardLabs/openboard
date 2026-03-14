import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Ticket } from '../types';
import { PriorityBadge } from './PriorityBadge';
import styles from './TicketCard.module.css';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CheckCircle, ExternalLink, GitPullRequest, Copy, ChevronDown, GitBranch, RotateCcw, Eye } from 'lucide-react';
import { getAgentConfig } from '../constants/agents';
import { DiffPanel } from './DiffPanel';

import { DropdownPortal } from './DropdownPortal';
import { ticketsApi } from '../api/tickets.api';
import { useApp } from '../store/AppContext';

interface TicketCardProps {
    ticket: Ticket;
    isOverlay?: boolean;
}

export function TicketCard({ ticket, isOverlay }: TicketCardProps) {
    const navigate = useNavigate();
    const { boardId } = useParams();
    const { state, removeAutoMovedEffect } = useApp();
    const isAutoMoved = state.recentlyAutoMoved.includes(ticket.id);

    useEffect(() => {
        if (isAutoMoved) {
            const timer = setTimeout(() => {
                removeAutoMovedEffect(ticket.id);
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [isAutoMoved, ticket.id, removeAutoMovedEffect]);

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

    // Find the most recent session with a PR URL or Worktree Path anywhere
    const prSession = [...(ticket.agent_sessions ?? [])].reverse().find(s => s.pr_url);
    const worktreeSession = [...(ticket.agent_sessions ?? [])].reverse().find(s => s.worktree_path);

    const [isWorktreeOpen, setIsWorktreeOpen] = useState(false);
    const [isMerging, setIsMerging] = useState(false);
    const [isDiffOpen, setIsDiffOpen] = useState(false);
    const worktreeTriggerRef = useRef<HTMLDivElement>(null);

    const handleMerge = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isMerging || worktreeSession?.merged) return;

        setIsMerging(true);
        try {
            const response = await fetch(`/api/boards/${boardId}/tickets/${ticket.id}/merge`, {
                method: 'POST',
            });
            if (!response.ok) {
                const data = await response.json();
                alert(`Failed to merge: ${data.error}`);
            }
        } catch (err) {
            console.error('Merge error:', err);
            alert('Failed to send merge request');
        } finally {
            setIsMerging(false);
            setIsWorktreeOpen(false);
        }
    };

    const handleSessionClick = async (e: React.MouseEvent, sessionIndex: number) => {
        if (!ticket || !boardId) return;
        e.stopPropagation();
        e.preventDefault();

        try {
            const { url } = await ticketsApi.resumeSession(boardId, ticket.id, sessionIndex);
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (err: any) {
            console.error('Failed to resume session:', err);
            const msg = err.message || 'Unknown error';
            alert(`Failed to connect to agent session: ${msg}\n\nIt might still be starting or the server failed to restart.`);
        }
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`${styles.card} ${isDragging ? styles.dragging : ''} ${hasNeedsApproval ? styles.needsApprovalCard : ''} ${isAutoMoved ? styles.autoMoved : ''}`}
            {...attributes}
            {...listeners}
            onClick={() => navigate(`/boards/${boardId}/tickets/${ticket.id}`)}
        >
            <div className={styles.header}>
                <div className={styles.badges}>
                    <PriorityBadge priority={ticket.priority} />
                    {(() => {
                        if (!ticket.agent_sessions || ticket.agent_sessions.length === 0) return null;

                        // Find the most recent session for this specific column
                        let activeSession = null;
                        let activeSessionIndex = -1;
                        for (let i = ticket.agent_sessions.length - 1; i >= 0; i--) {
                            if (ticket.agent_sessions[i].column_id === ticket.column_id) {
                                activeSession = ticket.agent_sessions[i];
                                activeSessionIndex = i;
                                break;
                            }
                        }

                        if (!activeSession) return null;

                        const session = activeSession;
                        const showActiveSession = session && (session.url || session.status === 'processing' || session.status === 'done' || session.status === 'blocked' || session.status === 'needs_approval');

                        if (!showActiveSession) return null;

                        return (
                            <button
                                key={(session?.column_id || 'no-col') + '-' + (session?.started_at || 'no-start')}
                                className={`${styles.statusBadge} ${session.status === 'processing' ? styles.processingBadge :
                                    session.status === 'done' ? styles.doneBadge :
                                        session.status === 'blocked' ? styles.blockedBadge :
                                            session.status === 'needs_approval' ? styles.needsApprovalBadge : ''
                                    }`}
                                title={session.url ? "Inspect Agent Session" : "Open Agent UI"}
                                onClick={(e) => handleSessionClick(e, activeSessionIndex)}
                            >
                                {session.status === 'done' ? <CheckCircle size={10} className={styles.doneIcon} /> :
                                    session.status === 'blocked' ? <span style={{ color: 'red', fontSize: '10px' }}>⚠️</span> :
                                        session.status === 'needs_approval' ? <span style={{ color: '#f59e0b', fontSize: '10px', lineHeight: 1 }}>✋</span> :
                                            React.cloneElement(getAgentConfig(session.agent_type).icon as React.ReactElement, { size: 10 })}
                                <span>
                                    {session.status === 'blocked' ? 'Error' :
                                        session.status === 'done' ? 'Done' :
                                            session.status === 'needs_approval' ? 'Needs Approval' :
                                                session.status === 'processing' ? getAgentConfig(session.agent_type).processingText :
                                                    'Agent UI'}
                                </span>
                            </button>
                        );
                    })()}
                </div>
            </div>

            <DiffPanel
                isOpen={isDiffOpen}
                onClose={() => setIsDiffOpen(false)}
                boardId={boardId!}
                ticket={ticket}
            />

            <p className={styles.title}>{ticket.title}</p>

            {ticket.description && (
                <p className={styles.description}>{ticket.description}</p>
            )}

            {(prSession || worktreeSession?.worktree_path) && (
                <div className={styles.footer}>
                    <div className={styles.footerActions}>
                        {prSession?.pr_url && (
                            <a
                                href={prSession.pr_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.actionBtn}
                                style={{ backgroundColor: '#2da44e', color: 'white', borderColor: '#2da44e' }}
                                title="View Code Review"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <GitPullRequest size={12} />
                                <span>PR</span>
                                <ExternalLink size={10} />
                            </a>
                        )}
                        {worktreeSession?.worktree_path && (
                            <div className={styles.dropdown} ref={worktreeTriggerRef}>
                                <button
                                    className={`${styles.actionBtn} ${styles.worktreeBtn}`}
                                    title="Worktree Actions"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIsWorktreeOpen(!isWorktreeOpen);
                                    }}
                                    style={worktreeSession.merged ? { backgroundColor: '#2da44e', color: 'white', borderColor: '#2da44e' } : {}}
                                >
                                    {worktreeSession.merged ? <CheckCircle size={12} /> : <Copy size={12} />}
                                    <span>{worktreeSession.merged ? 'Merged' : 'Worktree'}</span>
                                    <ChevronDown size={10} />
                                </button>
                                <DropdownPortal
                                    isOpen={isWorktreeOpen}
                                    onClose={() => setIsWorktreeOpen(false)}
                                    triggerRef={worktreeTriggerRef}
                                >
                                    <button
                                        className={styles.dropdownItem}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            navigator.clipboard.writeText(worktreeSession.worktree_path!);
                                            setIsWorktreeOpen(false);
                                        }}
                                    >
                                        <Copy size={14} className={styles.dropdownIcon} />
                                        <span>Copy Path</span>
                                    </button>
                                    <div className={styles.dropdownItemSeparator} />
                                    <button
                                        className={styles.dropdownItem}
                                        onClick={handleMerge}
                                        disabled={isMerging || worktreeSession.merged}
                                        style={(isMerging || worktreeSession.merged) ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                                    >
                                        {isMerging ? (
                                            <RotateCcw size={14} className={styles.processingIcon} />
                                        ) : (
                                            <GitBranch size={14} className={styles.dropdownIcon} />
                                        )}
                                        <span>{worktreeSession.merged ? 'Already merged' : isMerging ? 'Merging...' : 'Merge into master'}</span>
                                    </button>
                                    <div className={styles.dropdownItemSeparator} />
                                    <button
                                        className={styles.dropdownItem}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsDiffOpen(true);
                                            setIsWorktreeOpen(false);
                                        }}
                                    >
                                        <Eye size={14} className={styles.dropdownIcon} />
                                        <span>Check diff</span>
                                    </button>
                                </DropdownPortal>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
