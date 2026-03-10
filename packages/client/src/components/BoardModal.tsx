import { useState } from 'react';
import type { Board, BoardWorkspace } from '../types';
import { t } from '../i18n/i18n';
import styles from './BoardModal.module.css';
import { X, Plus, Trash2, Folder, Github } from 'lucide-react';

interface BoardModalProps {
    board?: Board; // If provided, we are editing
    onSave: (name: string, workspaces: Omit<BoardWorkspace, 'id' | 'board_id'>[]) => void;
    onCancel: () => void;
}

export function BoardModal({ board, onSave, onCancel }: BoardModalProps) {
    const [name, setName] = useState(board?.name ?? '');
    const [workspaces, setWorkspaces] = useState<Omit<BoardWorkspace, 'id' | 'board_id'>[]>(
        board?.workspaces.map(ws => ({ type: ws.type, path: ws.path })) ?? []
    );

    const handleAddWorkspace = () => {
        setWorkspaces([...workspaces, { type: 'folder', path: '' }]);
    };

    const handleRemoveWorkspace = (index: number) => {
        setWorkspaces(workspaces.filter((_, i) => i !== index));
    };

    const handleWorkspaceChange = (index: number, field: keyof Omit<BoardWorkspace, 'id' | 'board_id'>, value: string) => {
        const next = [...workspaces];
        next[index] = { ...next[index], [field]: value };
        setWorkspaces(next);
    };

    const handleSave = () => {
        if (!name.trim()) return;
        onSave(name.trim(), workspaces.filter(ws => ws.path.trim()));
    };

    return (
        <div className={styles.overlay} onClick={onCancel}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
                <div className={styles.header}>
                    <h2>{board ? t('board.edit') : t('nav.new_board')}</h2>
                    <button className={styles.closeBtn} onClick={onCancel}>
                        <X size={20} />
                    </button>
                </div>

                <div className={styles.content}>
                    <div className={styles.field}>
                        <label>{t('board.name')}</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder={t('board.rename_placeholder')}
                            className={styles.input}
                            autoFocus
                        />
                    </div>

                    <div className={styles.workspacesSection}>
                        <div className={styles.sectionHeader}>
                            <h3>{t('board.workspaces')}</h3>
                            <button className={styles.addBtn} onClick={handleAddWorkspace}>
                                <Plus size={14} />
                                {t('board.add_workspace')}
                            </button>
                        </div>

                        <div className={styles.workspaceList}>
                            {workspaces.map((ws, index) => (
                                <div key={index} className={styles.workspaceRow}>
                                    <select
                                        value={ws.type}
                                        onChange={e => handleWorkspaceChange(index, 'type', e.target.value)}
                                        className={styles.select}
                                    >
                                        <option value="folder">Folder</option>
                                        <option value="git">Git URL</option>
                                    </select>
                                    <div className={styles.pathInputWrapper}>
                                        {ws.type === 'folder' ? <Folder size={14} /> : <Github size={14} />}
                                        <input
                                            type="text"
                                            value={ws.path}
                                            onChange={e => handleWorkspaceChange(index, 'path', e.target.value)}
                                            placeholder={ws.type === 'folder' ? '/path/to/folder' : 'https://github.com/...'}
                                            className={styles.pathInput}
                                        />
                                    </div>
                                    <button className={styles.removeBtn} onClick={() => handleRemoveWorkspace(index)}>
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className={styles.footer}>
                    <button className={styles.cancelBtn} onClick={onCancel}>
                        {t('action.cancel')}
                    </button>
                    <button className={styles.saveBtn} onClick={handleSave} disabled={!name.trim()}>
                        {t('action.save')}
                    </button>
                </div>
            </div>
        </div>
    );
}
