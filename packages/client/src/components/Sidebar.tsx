import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { t } from '../i18n/i18n';
import { useApp } from '../store/AppContext';
import type { Board } from '../types';
import styles from './Sidebar.module.css';
import { Plus, LayoutDashboard, Trash2, Pencil } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import { BoardModal } from './BoardModal';
import type { BoardWorkspace } from '../types';

export function Sidebar() {
    const { boardId } = useParams();
    const navigate = useNavigate();
    const { state, createBoard, updateBoard, deleteBoard } = useApp();
    const [hovered, setHovered] = useState<string | null>(null);
    const [editingBoard, setEditingBoard] = useState<Board | null>(null);
    const [deletingBoard, setDeletingBoard] = useState<Board | null>(null);
    const [showingCreateModal, setShowingCreateModal] = useState(false);

    async function handleCreate(name: string, workspaces: Omit<BoardWorkspace, 'id' | 'board_id'>[]) {
        const board = await createBoard(name.trim(), workspaces);
        setShowingCreateModal(false);
        navigate(`/boards/${board.id}`);
    }

    return (
        <aside className={styles.sidebar}>
            <div className={styles.header}>
                <Link to="/" className={styles.logo}>
                    <LayoutDashboard size={16} />
                    {t('app.name')}
                </Link>
            </div>

            <div className={styles.section}>
                <span className={styles.sectionLabel}>{t('nav.boards')}</span>
                <button className={styles.newBtn} onClick={() => setShowingCreateModal(true)} title={t('nav.new_board')}>
                    <Plus size={14} />
                </button>
            </div>

            <nav className={styles.nav}>
                {state.boards.map(board => (
                    <div
                        key={board.id}
                        className={`${styles.boardItem} ${boardId === board.id ? styles.active : ''}`}
                        onMouseEnter={() => setHovered(board.id)}
                        onMouseLeave={() => setHovered(null)}
                    >
                        <Link to={`/boards/${board.id}`} className={styles.boardBtn}>
                            <span className={styles.boardDot} />
                            <span className="truncate">{board.name}</span>
                        </Link>
                        {hovered === board.id && (
                            <div className={styles.actions}>
                                <button className={styles.action} onClick={() => setEditingBoard(board)} title={t('board.rename')}>
                                    <Pencil size={12} />
                                </button>
                                <button className={styles.action} onClick={() => setDeletingBoard(board)} title={t('board.delete')}>
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </nav>

            {showingCreateModal && (
                <BoardModal
                    onSave={handleCreate}
                    onCancel={() => setShowingCreateModal(false)}
                />
            )}

            {editingBoard && (
                <BoardModal
                    board={editingBoard}
                    onSave={async (name, workspaces) => {
                        await updateBoard(editingBoard.id, name, workspaces);
                        setEditingBoard(null);
                    }}
                    onCancel={() => setEditingBoard(null)}
                />
            )}

            {deletingBoard && (
                <ConfirmDialog
                    message={t('confirm.delete_board')}
                    confirmLabel={t('action.confirm_delete')}
                    onConfirm={async () => { await deleteBoard(deletingBoard.id); setDeletingBoard(null); }}
                    onCancel={() => setDeletingBoard(null)}
                />
            )}
        </aside>
    );
}
