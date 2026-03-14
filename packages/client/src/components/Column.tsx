import { useState } from 'react';
import { t } from '../i18n/i18n';
import { useApp } from '../store/AppContext';
import type { Column as ColumnType, Ticket } from '../types';
import { TicketCard } from './TicketCard';
import { TicketModal } from './TicketModal';
import { ColumnConfigModal } from './ColumnConfigModal';
import { InlineEdit } from './InlineEdit';
import { ConfirmDialog } from './ConfirmDialog';
import styles from './Column.module.css';
import { Plus, MoreHorizontal, Pencil, Trash2, Bot } from 'lucide-react';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';

interface ColumnProps {
    column: ColumnType;
    tickets: Ticket[];
    boardId: string;
}

export function Column({ column, tickets, boardId }: ColumnProps) {
    const { state: { columnConfigs }, updateColumn, deleteColumn } = useApp();
    const [editing, setEditing] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [isAddingTicket, setIsAddingTicket] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);

    const config = columnConfigs.find(c => c.column_id === column.id);

    const { attributes, listeners, setNodeRef: setSortableRef, transform, transition, isDragging } = useSortable({
        id: column.id,
        data: { type: 'column', column },
    });

    const { setNodeRef: setDropRef } = useDroppable({ id: column.id, data: { type: 'column', column } });

    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        cursor: isDragging ? 'grabbing' : 'grab',
        opacity: isDragging ? 0 : 1,
    };


    async function handleAddClick() {
        setIsAddingTicket(true);
    }

    return (
        <div
            ref={setSortableRef}
            style={style}
            className={`${styles.column} ${isDragging ? styles.dragging : ''}`}
            {...attributes}
            {...listeners}
        >
            {/* Column header */}
            <div className={styles.header}>
                {editing ? (
                    <InlineEdit
                        defaultValue={column.name}
                        onSave={async name => { if (name.trim()) await updateColumn(boardId, column.id, name.trim()); setEditing(false); }}
                        onCancel={() => setEditing(false)}
                        className={styles.headerInput}
                    />
                ) : (
                    <div className={styles.headerRow}>
                        <div className={styles.nameAndCount}>
                            <span className={styles.name}>{column.name}</span>
                            <div className={styles.count}>{tickets.length}</div>
                        </div>
                        <div className={styles.headerActions}>
                            <button className={styles.iconBtn} onClick={handleAddClick} title={t('column.add_ticket')}>
                                <Plus size={14} />
                            </button>
                            <button
                                className={`${styles.iconBtn} ${config ? styles.botActive : ''}`}
                                onClick={() => setSettingsOpen(o => !o)}
                                title={config ? `${t('agent.type' as any)}: ${config.agent_type}` : t('board.edit')}
                            >
                                <Bot size={14} className={config ? styles.botIconAnimated : ''} />
                            </button>
                            <button className={styles.iconBtn} onClick={() => setMenuOpen(o => !o)}>
                                <MoreHorizontal size={14} />
                            </button>
                        </div>
                    </div>
                )}
                {settingsOpen && (
                    <ColumnConfigModal
                        column={column}
                        boardId={boardId}
                        onClose={() => setSettingsOpen(false)}
                    />
                )}
                {menuOpen && !editing && (
                    <div className={styles.menu} onMouseLeave={() => setMenuOpen(false)}>
                        <button className={styles.menuItem} onClick={() => { setEditing(true); setMenuOpen(false); }}>
                            <Pencil size={13} /> {t('column.rename')}
                        </button>
                        <button className={`${styles.menuItem} ${styles.danger}`} onClick={() => { setConfirming(true); setMenuOpen(false); }}>
                            <Trash2 size={13} /> {t('column.delete')}
                        </button>
                    </div>
                )}
            </div>

            {/* Ticket list */}
            <div ref={setDropRef} className={styles.body}>
                <SortableContext items={tickets.map(t => t.id)} strategy={verticalListSortingStrategy}>
                    {tickets.map(ticket => (
                        <TicketCard key={ticket.id} ticket={ticket} />
                    ))}
                </SortableContext>

                {tickets.length === 0 && (
                    <div className={styles.empty}>{t('column.empty')}</div>
                )}
            </div>

            {/* Footer - No add button anymore */}

            {isAddingTicket && (
                <TicketModal
                    columnId={column.id}
                    onClose={() => setIsAddingTicket(false)}
                />
            )}

            {confirming && (
                <ConfirmDialog
                    message={t('confirm.delete_column')}
                    confirmLabel={t('action.confirm_delete')}
                    onConfirm={async () => { await deleteColumn(boardId, column.id); setConfirming(false); }}
                    onCancel={() => setConfirming(false)}
                />
            )}
        </div>
    );
}
