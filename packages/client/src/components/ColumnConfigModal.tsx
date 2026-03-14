import { useState, useEffect } from 'react';
import { t } from '../i18n/i18n';
import { useApp } from '../store/AppContext';
import type { Column, AgentType } from '../types';
import styles from './ColumnConfigModal.module.css';
import {
    X,
    Settings,
    GitPullRequest,
    GitBranch,
    ArrowRight,
    Ban,
    ChevronDown
} from 'lucide-react';
import { getAgentConfig } from '../constants/agents';

interface ColumnConfigModalProps {
    column: Column;
    boardId: string;
    onClose: () => void;
}

export function ColumnConfigModal({ column, boardId, onClose }: ColumnConfigModalProps) {
    const { state: { columnConfigs, columns }, updateColumnConfig, deleteColumnConfig } = useApp();
    const config = columnConfigs.find(c => c.column_id === column.id);

    const [agentType, setAgentType] = useState<AgentType>(config?.agent_type ?? 'none');
    const [maxAgents, setMaxAgents] = useState(config?.max_agents ?? 1);
    const [reviewMode, setReviewMode] = useState<'pr' | 'local'>(config?.review_mode ?? 'pr');
    const [onFinishColumnId, setOnFinishColumnId] = useState<string>(config?.on_finish_column_id ?? '');
    const [onRejectColumnId, setOnRejectColumnId] = useState<string>(config?.on_reject_column_id ?? '');

    const [isDirty, setIsDirty] = useState(false);
    const [isFinishSelectOpen, setIsFinishSelectOpen] = useState(false);
    const [isRejectSelectOpen, setIsRejectSelectOpen] = useState(false);

    useEffect(() => {
        setIsDirty(
            agentType !== (config?.agent_type ?? 'none') ||
            maxAgents !== (config?.max_agents ?? 1) ||
            reviewMode !== (config?.review_mode ?? 'pr') ||
            onFinishColumnId !== (config?.on_finish_column_id ?? '') ||
            onRejectColumnId !== (config?.on_reject_column_id ?? '')
        );
    }, [agentType, maxAgents, reviewMode, onFinishColumnId, onRejectColumnId, config]);

    useEffect(() => {
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose();
        }
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    async function handleSave() {
        if (agentType === 'none') {
            await deleteColumnConfig(boardId, column.id);
        } else {
            await updateColumnConfig(boardId, column.id, {
                agentType,
                maxAgents,
                reviewMode: agentType === 'opencode' ? reviewMode : 'pr',
                onFinishColumnId: onFinishColumnId || null,
                onRejectColumnId: agentType === 'code_review' ? (onRejectColumnId || null) : null
            });
        }
        onClose();
    }

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
                <div className={styles.header}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Settings size={18} />
                        {t('column.settings' as any)}
                    </div>
                    <button className={styles.closeBtn} onClick={onClose}><X size={16} /></button>
                </div>

                <div className={styles.body}>
                    <div className={styles.formGroup}>
                        <label className={styles.label}>{t('agent.type' as any)}</label>
                        <div className={styles.cardGrid}>
                            {(['none', 'opencode', 'code_review'] as AgentType[]).map(type => {
                                const isActive = agentType === type;
                                const configForType = type === 'none' ? getAgentConfig('default') : getAgentConfig(type);
                                return (
                                    <button
                                        key={type}
                                        type="button"
                                        className={`${styles.optionCard} ${isActive ? styles.optionCardActive : ''}`}
                                        onClick={() => setAgentType(type)}
                                    >
                                        <div className={styles.optionCardHeader}>
                                            <span className={styles.optionIcon}>{configForType.icon}</span>
                                            <span className={styles.optionTitle}>
                                                {type === 'none'
                                                    ? t('agent.none' as any)
                                                    : configForType.label}
                                            </span>
                                        </div>
                                        <span className={styles.optionSubtitle}>
                                            {type === 'none'
                                                ? 'No automation for this column'
                                                : type === 'opencode'
                                                    ? 'Let the agent implement tickets for you'
                                                    : 'Have an agent review code changes'}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {(agentType === 'opencode' || agentType === 'code_review') && (
                        <>
                            <div className={styles.formGroup}>
                                <label className={styles.label}>Max Concurrent Agents</label>
                                <input
                                    type="number"
                                    className={styles.input}
                                    value={maxAgents}
                                    min={1}
                                    max={10}
                                    onChange={(e) => setMaxAgents(parseInt(e.target.value) || 1)}
                                />
                            </div>
                            {agentType === 'opencode' && (
                                <div className={styles.formGroup}>
                                    <label className={styles.label}>Review Mode</label>
                                    <div className={styles.cardGrid}>
                                        {(['pr', 'local'] as ('pr' | 'local')[]).map(mode => {
                                            const isActive = reviewMode === mode;
                                            const Icon = mode === 'pr' ? GitPullRequest : GitBranch;
                                            return (
                                                <button
                                                    key={mode}
                                                    type="button"
                                                    className={`${styles.optionCard} ${isActive ? styles.optionCardActive : ''}`}
                                                    onClick={() => setReviewMode(mode)}
                                                >
                                                    <div className={styles.optionCardHeader}>
                                                        <span className={styles.optionIcon}>
                                                            <Icon size={16} />
                                                        </span>
                                                        <span className={styles.optionTitle}>
                                                            {mode === 'pr' ? 'PR Review' : 'Local Worktree'}
                                                        </span>
                                                    </div>
                                                    <span className={styles.optionSubtitle}>
                                                        {mode === 'pr'
                                                            ? 'Open a GitHub PR and review changes there'
                                                            : 'Review and merge from a local worktree'}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {agentType !== 'none' && (
                        <div className={styles.formGroup}>
                            <label className={styles.label}>On Finish</label>
                            <div className={styles.flowSelectRow}>
                                <span className={styles.flowPillCurrent}>{column.name}</span>
                                <ArrowRight size={14} className={styles.flowArrow} />
                                <div className={styles.selectPillWrapper}>
                                    <button
                                        type="button"
                                        className={styles.selectPill}
                                        onClick={() => setIsFinishSelectOpen(!isFinishSelectOpen)}
                                    >
                                        <span className={styles.selectPillLabel}>
                                            {onFinishColumnId === ''
                                                ? t('agent.do_nothing' as any)
                                                : columns.find(c => c.id === onFinishColumnId)?.name || ''}
                                        </span>
                                        <ChevronDown size={14} />
                                    </button>
                                    {isFinishSelectOpen && (
                                        <div className={styles.selectMenu}>
                                            <button
                                                type="button"
                                                className={styles.selectMenuItem}
                                                onClick={() => {
                                                    setOnFinishColumnId('');
                                                    setIsFinishSelectOpen(false);
                                                }}
                                            >
                                                <Ban size={14} />
                                                <span>{t('agent.do_nothing' as any)}</span>
                                            </button>
                                            <div className={styles.selectMenuSeparator} />
                                            {columns
                                                .filter(c => c.id !== column.id)
                                                .map(c => (
                                                    <button
                                                        key={c.id}
                                                        type="button"
                                                        className={styles.selectMenuItem}
                                                        onClick={() => {
                                                            setOnFinishColumnId(c.id);
                                                            setIsFinishSelectOpen(false);
                                                        }}
                                                    >
                                                        <span className={styles.flowTargetDot} />
                                                        <span>{c.name}</span>
                                                    </button>
                                                ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {agentType === 'code_review' && (
                        <div className={styles.formGroup}>
                            <label className={styles.label}>On Reject</label>
                            <div className={styles.flowSelectRow}>
                                <span className={styles.flowPillCurrent}>{column.name}</span>
                                <ArrowRight size={14} className={styles.flowArrow} />
                                <div className={styles.selectPillWrapper}>
                                    <button
                                        type="button"
                                        className={styles.selectPill}
                                        onClick={() => setIsRejectSelectOpen(!isRejectSelectOpen)}
                                    >
                                        <span className={styles.selectPillLabel}>
                                            {onRejectColumnId === ''
                                                ? t('agent.do_nothing' as any)
                                                : columns.find(c => c.id === onRejectColumnId)?.name || ''}
                                        </span>
                                        <ChevronDown size={14} />
                                    </button>
                                    {isRejectSelectOpen && (
                                        <div className={styles.selectMenu}>
                                            <button
                                                type="button"
                                                className={styles.selectMenuItem}
                                                onClick={() => {
                                                    setOnRejectColumnId('');
                                                    setIsRejectSelectOpen(false);
                                                }}
                                            >
                                                <Ban size={14} />
                                                <span>{t('agent.do_nothing' as any)}</span>
                                            </button>
                                            <div className={styles.selectMenuSeparator} />
                                            {columns
                                                .filter(c => c.id !== column.id)
                                                .map(c => (
                                                    <button
                                                        key={c.id}
                                                        type="button"
                                                        className={styles.selectMenuItem}
                                                        onClick={() => {
                                                            setOnRejectColumnId(c.id);
                                                            setIsRejectSelectOpen(false);
                                                        }}
                                                    >
                                                        <span className={styles.flowTargetDot} />
                                                        <span>{c.name}</span>
                                                    </button>
                                                ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className={styles.footer}>
                    <button className={styles.cancelBtn} onClick={onClose}>{t('action.cancel')}</button>
                    <button className={styles.saveBtn} onClick={handleSave} disabled={!isDirty}>
                        {t('action.save')}
                    </button>
                </div>
            </div>
        </div>
    );
}
