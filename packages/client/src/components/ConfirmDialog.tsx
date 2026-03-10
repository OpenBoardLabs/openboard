import { useEffect } from 'react';
import { t } from '../i18n/i18n';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmDialog({ message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
    useEffect(() => {
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter') onConfirm();
        }
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onConfirm, onCancel]);

    return (
        <div className={styles.overlay} onClick={onCancel}>
            <div className={styles.dialog} onClick={e => e.stopPropagation()}>
                <p className={styles.message}>{message}</p>
                <div className={styles.actions}>
                    <button className={styles.cancel} onClick={onCancel}>{t('action.cancel')}</button>
                    <button className={styles.confirm} onClick={onConfirm}>{confirmLabel}</button>
                </div>
            </div>
        </div>
    );
}
