import { useState, useEffect } from 'react';
import { t } from '../i18n/i18n';
import { useApp } from '../store/AppContext';
import type { Column, AgentType } from '../types';
import styles from './ColumnConfigModal.module.css';
import { X, Settings } from 'lucide-react';

interface ColumnConfigModalProps {
    column: Column;
    boardId: string;
    onClose: () => void;
}

export function ColumnConfigModal({ column, boardId, onClose }: ColumnConfigModalProps) {
    const { state: { columnConfigs, columns }, updateColumnConfig, deleteColumnConfig } = useApp();
    const config = columnConfigs.find(c => c.column_id === column.id);

    const [agentType, setAgentType] = useState<AgentType>(config?.agent_type ?? 'none');
    const [agentModel, setAgentModel] = useState(config?.agent_model ?? 'gpt-4o');
    const [maxAgents, setMaxAgents] = useState(config?.max_agents ?? 1);
    const [onFinishColumnId, setOnFinishColumnId] = useState<string>(config?.on_finish_column_id ?? '');

    const [isDirty, setIsDirty] = useState(false);

    useEffect(() => {
        setIsDirty(
            agentType !== (config?.agent_type ?? 'none') ||
            agentModel !== (config?.agent_model ?? 'gpt-4o') ||
            maxAgents !== (config?.max_agents ?? 1) ||
            onFinishColumnId !== (config?.on_finish_column_id ?? '')
        );
    }, [agentType, agentModel, maxAgents, onFinishColumnId, config]);

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
                agentModel: agentType === 'opencode' ? agentModel : null,
                maxAgents,
                onFinishColumnId: onFinishColumnId || null
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
                        <select
                            className={styles.select}
                            value={agentType}
                            onChange={(e) => setAgentType(e.target.value as AgentType)}
                        >
                            <option value="none">{t('agent.none' as any)}</option>
                            <option value="dummy">{t('agent.dummy' as any)}</option>
                            <option value="opencode">OpenCode Agent</option>
                        </select>
                    </div>

                    {agentType === 'opencode' && (
                        <>
                            <div className={styles.formGroup}>
                                <label className={styles.label}>OpenCode Model</label>
                                <input
                                    type="text"
                                    className={styles.input}
                                    value={agentModel}
                                    onChange={(e) => setAgentModel(e.target.value)}
                                    placeholder="e.g. gpt-4o, claude-3-haiku"
                                />
                            </div>
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
                        </>
                    )}

                    {agentType !== 'none' && (
                        <div className={styles.formGroup}>
                            <label className={styles.label}>{t('agent.on_finish' as any)}</label>
                            <select
                                className={styles.select}
                                value={onFinishColumnId}
                                onChange={(e) => setOnFinishColumnId(e.target.value)}
                            >
                                <option value="">{t('agent.do_nothing' as any)}</option>
                                {columns.filter(c => c.id !== column.id).map(c => (
                                    <option key={c.id} value={c.id}>{t('agent.move_to' as any)} {c.name}</option>
                                ))}
                            </select>
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
