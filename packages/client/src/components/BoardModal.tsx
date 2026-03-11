import { useState } from 'react';
import type { Board, BoardWorkspace } from '../types';
import { t } from '../i18n/i18n';
import styles from './BoardModal.module.css';
import { X } from 'lucide-react';

interface BoardModalProps {
    board?: Board; // If provided, we are editing
    onSave: (name: string, workspaces: Omit<BoardWorkspace, 'id' | 'board_id'>[]) => void;
    onCancel: () => void;
}

export function BoardModal({ board, onSave, onCancel }: BoardModalProps) {
    const [name, setName] = useState(board?.name ?? '');
    const handleSave = () => {

        if (!name.trim()) return;
        onSave(name.trim(), []);
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
