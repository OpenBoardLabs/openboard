import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { t } from '../i18n/i18n';
import { useApp } from '../store/AppContext';
import type { Ticket, Priority } from '../types';
import { PRIORITIES } from '../constants';
import { PriorityBadge } from './PriorityBadge';
import { ConfirmDialog } from './ConfirmDialog';
import styles from './TicketModal.module.css';
import { X, Trash2, MessageSquare, Send, CheckCircle, ExternalLink, RotateCcw, GitPullRequest, Copy } from 'lucide-react';
import { getAgentConfig, getAgentConfigByAuthor } from '../constants/agents';

interface TicketModalProps {
    ticket?: Ticket;
    columnId?: string;
    onClose: () => void;
}

export function TicketModal({ ticket, columnId, onClose }: TicketModalProps) {
    const { state, updateTicket, deleteTicket, createTicket: apiCreateTicket, retryTicket } = useApp();
    const [title, setTitle] = useState(ticket?.title ?? '');
    const [description, setDescription] = useState(ticket?.description ?? '');
    const [priority, setPriority] = useState<Priority>(ticket?.priority ?? 'medium');
    const [isDirty, setIsDirty] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [newComment, setNewComment] = useState('');
    const { state: { comments }, loadComments, addComment } = useApp();
    const ticketComments = ticket ? (comments[ticket.id] ?? []) : [];

    useEffect(() => {
        if (ticket) {
            loadComments(ticket.board_id, ticket.id);
        }
    }, [ticket, loadComments]);

    useEffect(() => {
        setIsDirty(
            title !== (ticket?.title ?? '') ||
            description !== (ticket?.description ?? '') ||
            priority !== (ticket?.priority ?? 'medium')
        );
    }, [title, description, priority, ticket]);

    useEffect(() => {
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape' && !confirming) onClose();
        }
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose, confirming]);

    async function handleSave() {
        if (!title.trim()) return;
        if (ticket) {
            await updateTicket(ticket.board_id, ticket.id, { title: title.trim(), description, priority });
        } else if (columnId && state.activeBoardId) {
            await apiCreateTicket(state.activeBoardId, { columnId, title: title.trim(), description, priority });
        }
        onClose();
    }

    async function handleDelete() {
        if (!ticket) return;
        await deleteTicket(ticket.board_id, ticket.id);
        onClose();
    }

    async function handleAddComment() {
        if (!newComment.trim() || !ticket) return;
        await addComment(ticket.board_id, ticket.id, newComment.trim(), 'user');
        setNewComment('');
    }

    const column = state.columns.find(c => c.id === (ticket?.column_id ?? columnId));

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className={styles.header}>
                    <div className={styles.meta}>
                        {column && <span className={styles.columnTag}>{column.name}</span>}
                        <PriorityBadge priority={priority} size="md" />

                        {/* Current Column Status Badge */}
                        {(() => {
                            if (!ticket?.agent_sessions || ticket.agent_sessions.length === 0) return null;
                            let activeSession = null;
                            for (let i = ticket.agent_sessions.length - 1; i >= 0; i--) {
                                if (ticket.agent_sessions[i].column_id === ticket.column_id) {
                                    activeSession = ticket.agent_sessions[i];
                                    break;
                                }
                            }
                            if (!activeSession) return null;

                            const session = activeSession;
                            if (session.status === 'processing') {
                                const agentConfig = getAgentConfig(session.agent_type);
                                return (
                                    <div key={session.started_at} className={`${styles.statusBadge} ${styles.processing}`}>
                                        <span className={styles.pulse}>{agentConfig.icon}</span>
                                        {agentConfig.processingText}
                                    </div>
                                );
                            }
                            if (session.status === 'done') return (
                                <div key={session.started_at} className={`${styles.statusBadge} ${styles.done}`}>
                                    <CheckCircle size={12} />
                                    {t('agent.status.done' as any)}
                                    {session.total_cost !== undefined && session.total_cost > 0 && (
                                        <span className={styles.costBadge}>${session.total_cost.toFixed(2)}</span>
                                    )}
                                </div>
                            );
                            if (session.status === 'blocked') return (
                                <div key={session.started_at} className={`${styles.statusBadge} ${styles.blocked}`} title="Agent execution failed or blocked">
                                    <span style={{ color: 'white' }}>⚠️</span>
                                    Error
                                </div>
                            );
                            if (session.status === 'needs_approval') return (
                                <div key={session.started_at} className={`${styles.statusBadge} ${styles.needsApproval}`} title="Agent requires user permission">
                                    <span style={{ color: '#f59e0b' }}>✋</span>
                                    Needs Approval
                                </div>
                            );
                            return null;
                        })()}
                    </div>
                    <div className={styles.headerRight}>
                        {/* Action buttons mapped from session history */}
                        {(() => {
                            if (!ticket?.agent_sessions || ticket.agent_sessions.length === 0) return null;
                            let activeSession = null;
                            for (let i = ticket.agent_sessions.length - 1; i >= 0; i--) {
                                if (ticket.agent_sessions[i].column_id === ticket.column_id) {
                                    activeSession = ticket.agent_sessions[i];
                                    break;
                                }
                            }

                            let prSession = null;
                            for (let i = ticket.agent_sessions.length - 1; i >= 0; i--) {
                                if (ticket.agent_sessions[i].pr_url) {
                                    prSession = ticket.agent_sessions[i];
                                    break;
                                }
                            }

                            let worktreeSession = null;
                            for (let i = ticket.agent_sessions.length - 1; i >= 0; i--) {
                                if (ticket.agent_sessions[i].worktree_path) {
                                    worktreeSession = ticket.agent_sessions[i];
                                    break;
                                }
                            }

                            if (!activeSession && !prSession && !worktreeSession) return null;
                            const session = activeSession;

                            return (
                                <React.Fragment key={(session?.started_at || prSession?.started_at || worktreeSession?.started_at)}>
                                    {session?.status === 'blocked' && (
                                        <button
                                            className={styles.sessionBtn}
                                            onClick={() => retryTicket(ticket.board_id, ticket.id)}
                                            title="Retry Agent Execution"
                                        >
                                            <RotateCcw size={14} />
                                            <span>Retry Agent</span>
                                        </button>
                                    )}
                                    {session?.url && (
                                        <a
                                            href={session.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={styles.sessionBtn}
                                            title="Open Agent Session"
                                        >
                                            <ExternalLink size={14} />
                                            <span>Agent session</span>
                                        </a>
                                    )}
                                    {prSession?.pr_url && (
                                        <a
                                            href={prSession.pr_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={styles.sessionBtn}
                                            style={{ backgroundColor: '#2da44e', color: 'white', borderColor: '#2da44e' }}
                                            title="View Code Review"
                                        >
                                            <GitPullRequest size={14} />
                                            <span>PR</span>
                                        </a>
                                    )}
                                    {worktreeSession?.worktree_path && (
                                        <button
                                            className={styles.sessionBtn}
                                            title="Copy Worktree Path"
                                            onClick={() => navigator.clipboard.writeText(worktreeSession!.worktree_path!)}
                                        >
                                            <Copy size={14} />
                                            <span>Worktree</span>
                                        </button>
                                    )}
                                </React.Fragment>
                            );
                        })()}
                        <button className={styles.closeBtn} onClick={onClose}><X size={16} /></button>
                    </div>
                </div>

                <div className={styles.content}>
                    <div className={styles.body}>



                        {/* Title */}
                        <textarea
                            className={styles.titleInput}
                            value={title}
                            onChange={e => { setTitle(e.target.value); }}
                            placeholder={t('ticket.title_placeholder')}
                            rows={1}
                        />

                        {/* Description */}
                        <textarea
                            className={styles.descInput}
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder={t('ticket.description_placeholder')}
                            rows={6}
                        />
                    </div>

                    {/* Priority picker */}
                    <div className={styles.section}>
                        <span className={styles.sectionLabel}>{t('ticket.priority')}</span>
                        <div className={styles.priorities}>
                            {PRIORITIES.map(p => (
                                <button
                                    key={p.value}
                                    className={`${styles.priorityBtn} ${priority === p.value ? styles.selected : ''}`}
                                    style={{ '--priority-color': p.colorVar } as React.CSSProperties}
                                    onClick={() => setPriority(p.value as Priority)}
                                >
                                    {t(p.labelKey as Parameters<typeof t>[0])}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Agent History */}
                    {ticket && ticket.agent_sessions && ticket.agent_sessions.length > 0 && (
                        <div className={styles.section}>
                            <div className={styles.historyHeader}>
                                <span className={styles.sectionLabel}>
                                    Agent History
                                </span>
                                <span className={styles.historyTotalCost}>
                                    Total: ${ticket.agent_sessions.reduce((sum, s) => sum + (s.total_cost || 0), 0).toFixed(2)}
                                </span>
                            </div>
                            <div className={styles.agentHistoryList}>
                                {ticket.agent_sessions.map((session, idx) => {
                                    const colName = state.columns.find(c => c.id === session.column_id)?.name || 'Unknown Step';
                                    return (
                                        <div key={idx} className={styles.historyItem}>
                                            <div className={styles.historyMain}>
                                                <div className={styles.historyDetails}>
                                                    <span className={styles.historyCol}>{colName}</span>
                                                    <div className={styles.historyLinks}>
                                                        {(session.url || session.port) && (
                                                            <a
                                                                href={session.url || `http://127.0.0.1:${session.port}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className={styles.historyLink}
                                                            >
                                                                Session Link <ExternalLink size={12} />
                                                            </a>
                                                        )}
                                                        {session.pr_url && (
                                                            <a
                                                                href={session.pr_url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className={styles.historyLink}
                                                                style={{ color: '#2da44e' }}
                                                            >
                                                                Code Review <GitPullRequest size={12} />
                                                            </a>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className={styles.historyStatusAndCost}>
                                                    <span className={`${styles.historyStatus} ${styles[session.status] || ''}`}>
                                                        <span style={{ marginRight: '4px', display: 'inline-flex', verticalAlign: 'middle' }}>
                                                            {getAgentConfig(session.agent_type).icon}
                                                        </span>
                                                        {session.status === 'needs_approval' ? 'Needs Approval' : session.status}
                                                    </span>
                                                    {session.total_cost !== undefined && session.total_cost > 0 && (
                                                        <span className={styles.historyCost}>${session.total_cost.toFixed(2)}</span>
                                                    )}
                                                </div>
                                            </div>
                                            {session.error_message && (
                                                <div className={styles.historyError}>
                                                    {session.error_message}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Comments Section */}
                    {ticket && (
                        <div className={styles.commentsSection}>

                            <div className={styles.sectionLabel} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <MessageSquare size={14} />
                                {t('ticket.comments' as any)}
                            </div>

                            <div className={styles.commentList}>
                                {ticketComments.map(c => (
                                    <div key={c.id} className={styles.comment}>
                                        <div className={styles.commentHeader}>
                                            <span className={styles.commentAuthor}>
                                                {c.author === 'user' ? 'You' : (
                                                    <>
                                                        <span style={{ marginRight: '4px', display: 'inline-flex', verticalAlign: 'middle' }}>
                                                            {getAgentConfigByAuthor(c.author).icon}
                                                        </span>
                                                        {c.author}
                                                    </>
                                                )}
                                            </span>
                                            <span className={styles.commentDate}>
                                                {new Date(c.created_at).toLocaleString()}
                                            </span>
                                        </div>
                                        <div className={styles.commentContent}>
                                            <ReactMarkdown>{c.content}</ReactMarkdown>
                                        </div>
                                    </div>
                                ))}
                                {ticketComments.length === 0 && (
                                    <div className={styles.noComments}>{t('ticket.no_comments' as any)}</div>
                                )}
                            </div>

                            <div className={styles.addComment}>
                                <input
                                    type="text"
                                    className={styles.commentInput}
                                    value={newComment}
                                    onChange={e => setNewComment(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleAddComment()}
                                    placeholder={t('ticket.add_comment_placeholder' as any)}
                                />
                                <button
                                    className={styles.sendBtn}
                                    onClick={handleAddComment}
                                    disabled={!newComment.trim()}
                                >
                                    <Send size={14} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                {/* Footer */}
                <div className={styles.footer}>
                    {ticket ? (
                        <button className={styles.deleteBtn} onClick={() => setConfirming(true)}>
                            <Trash2 size={14} />
                            {t('ticket.delete')}
                        </button>
                    ) : (
                        <div />
                    )}
                    <div className={styles.footerActions}>
                        <button className={styles.cancelBtn} onClick={onClose}>{t('action.cancel')}</button>
                        <button className={styles.saveBtn} onClick={handleSave} disabled={!isDirty || !title.trim()}>
                            {t('action.save')}
                        </button>
                    </div>
                </div>

                {confirming && (
                    <ConfirmDialog
                        message={t('confirm.delete_ticket')}
                        confirmLabel={t('action.confirm_delete')}
                        onConfirm={handleDelete}
                        onCancel={() => setConfirming(false)}
                    />
                )}
            </div>
        </div>
    );
}
