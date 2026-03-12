import { useState } from 'react';
import type { Board, BoardWorkspace } from '../types';
import { t } from '../i18n/i18n';
import styles from './BoardModal.module.css';
import { X, Folder } from 'lucide-react';
import { FolderPicker } from './FolderPicker';

interface BoardModalProps {
    board?: Board; // If provided, we are editing
    onSave: (name: string, path: string | undefined, workspaces: Omit<BoardWorkspace, 'id' | 'board_id'>[]) => void;
    onCancel: () => void;
}

export function BoardModal({ board, onSave, onCancel }: BoardModalProps) {
    const [name, setName] = useState(board?.name ?? '');
    const [path, setPath] = useState(board?.path ?? '');
    const [showPicker, setShowPicker] = useState(false);

    const handleSave = () => {
        if (!name.trim()) return;
        onSave(name.trim(), path.trim() || undefined, []);
    };

    return (
        <>
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

                        <div className={styles.field}>
                            <label>{t('board.path') ?? 'Folder Path'}</label>
                            <div className={styles.pathPickerTrigger} onClick={() => setShowPicker(true)}>
                                <Folder size={16} className={styles.folderIcon} />
                                <span className={path ? styles.pathValue : styles.pathPlaceholder}>
                                    {path || 'Select folder...'}
                                </span>
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
            {showPicker && (
                <FolderPicker 
                    initialPath={path} 
                    onSelect={setPath} 
                    onClose={() => setShowPicker(false)} 
                />
            )}
        </>
    );
}
