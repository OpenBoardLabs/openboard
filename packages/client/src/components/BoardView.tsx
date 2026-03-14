import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { t } from '../i18n/i18n';
import { useApp } from '../store/AppContext';
import { Column } from './Column';
import { InlineEdit } from './InlineEdit';
import { TicketModal } from './TicketModal';
import { TicketCard } from './TicketCard';
import styles from './BoardView.module.css';
import { Plus, LayoutDashboard, Settings } from 'lucide-react';
import { BoardModal } from './BoardModal';
import {
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
    DragOverEvent,
    DragStartEvent,
    closestCenter,
    DragOverlay,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import type { Ticket, Column as ColumnType } from '../types';

export function BoardView() {
    const { boardId, ticketId } = useParams();
    const navigate = useNavigate();
    const { state, createColumn, moveTicket, selectBoard, loadBoardData, updateBoard, reorderColumns } = useApp();
    const { activeBoardId, columns, tickets, loading, boards } = state;
    const [addingColumn, setAddingColumn] = useState(false);
    const [isEditingBoard, setIsEditingBoard] = useState(false);

    const [localTickets, setLocalTickets] = useState<Ticket[] | null>(null);
    const [activeColumn, setActiveColumn] = useState<ColumnType | null>(null);
    const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);

    const dragDestRef = useRef<{ columnId: string; index: number } | null>(null);

    const sensors = useSensors(useSensor(PointerSensor, {
        activationConstraint: { distance: 5 }
    }));

    const displayedTickets = localTickets ?? tickets;

    useEffect(() => {
        if (boardId && boardId !== activeBoardId) {
            selectBoard(boardId);
            loadBoardData(boardId);
        }
    }, [boardId, activeBoardId, selectBoard, loadBoardData]);

    if (!boardId) {
        return (
            <div className={styles.emptyView}>
                <LayoutDashboard size={40} strokeWidth={1} />
                <h2 className={styles.emptyTitle}>{t('board.empty_title')}</h2>
                <p className={styles.emptySubtitle}>{t('board.empty_subtitle')}</p>
            </div>
        );
    }

    const board = boards.find(b => b.id === (boardId || activeBoardId));
    const sortedColumns = [...columns].sort((a, b) => a.position - b.position);

    const selectedTicket = ticketId ? tickets.find(t => t.id === ticketId) : null;

    function getTicketsForColumn(columnId: string): Ticket[] {
        return displayedTickets
            .filter(t => t.column_id === columnId)
            .sort((a, b) => a.position - b.position);
    }

    function handleDragStart(event: DragStartEvent) {
        dragDestRef.current = null;
        const activeData = event.active.data.current as { type?: string; ticket?: Ticket; column?: ColumnType } | undefined;
        if (activeData?.type === 'column' && activeData.column) setActiveColumn(activeData.column);
        if (activeData?.type === 'ticket' && activeData.ticket) setActiveTicket(activeData.ticket);
    }

    function handleDragOver(event: DragOverEvent) {
        const { active, over } = event;
        if (!over) return;

        const activeId = active.id as string;
        const overId = over.id as string;

        const activeData = active.data.current as { type: string; ticket?: Ticket } | undefined;
        if (activeData?.type !== 'ticket') return;

        const overData = over.data.current as { type: string; ticket?: Ticket; column?: { id: string } } | undefined;

        let destColumnId: string;
        let destIndex = -1;

        if (overData?.type === 'column') {
            destColumnId = overId;
        } else if (overData?.type === 'ticket' && overData.ticket) {
            destColumnId = overData.ticket.column_id;
        } else {
            destColumnId = overId;
        }

        const currentTickets = localTickets ?? tickets;
        const activeTicketInState = currentTickets.find(t => t.id === activeId);
        if (!activeTicketInState) return;

        const sourceColumnId = activeTicketInState.column_id;

        const destTickets = currentTickets
            .filter(t => t.column_id === destColumnId && t.id !== activeId)
            .sort((a, b) => a.position - b.position);

        if (overData?.type === 'ticket') {
            destIndex = destTickets.findIndex(t => t.id === overId);
        } else {
            destIndex = destTickets.length;
        }
        if (destIndex === -1) destIndex = destTickets.length;

        if (sourceColumnId !== destColumnId) {
            setLocalTickets(() => {
                const otherTickets = currentTickets.filter(t => t.id !== activeId);
                const updatedActive = { ...activeTicketInState, column_id: destColumnId };

                const destColTickets = otherTickets.filter(t => t.column_id === destColumnId).sort((a, b) => a.position - b.position);
                destColTickets.splice(destIndex, 0, updatedActive);

                const finalTickets = otherTickets.filter(t => t.column_id !== destColumnId);
                destColTickets.forEach((t, i) => { t.position = i; });

                return [...finalTickets, ...destColTickets];
            });
        } else {
            const colTickets = currentTickets.filter(t => t.column_id === sourceColumnId).sort((a, b) => a.position - b.position);
            const oldIdx = colTickets.findIndex(t => t.id === activeId);
            const newIdx = colTickets.findIndex(t => t.id === overId);

            if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
                setLocalTickets(() => {
                    const moved = arrayMove(colTickets, oldIdx, newIdx);
                    moved.forEach((t, i) => { t.position = i; });
                    const others = currentTickets.filter(t => t.column_id !== sourceColumnId);
                    return [...others, ...moved];
                });
                destIndex = newIdx;
            } else if (oldIdx !== -1) {
                destIndex = oldIdx;
            }
        }

        dragDestRef.current = { columnId: destColumnId, index: destIndex };
    }

    async function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        const activeData = active.data.current as { type: string } | undefined;

        setActiveColumn(null);
        setActiveTicket(null);

        // Column reordering
        if (activeData?.type === 'column' && over) {
            const activeId = active.id as string;
            const overId = over.id as string;

            if (activeId !== overId) {
                const orderedIds = [...columns].sort((a, b) => a.position - b.position).map(c => c.id);
                const oldIndex = orderedIds.indexOf(activeId);
                const newIndex = orderedIds.indexOf(overId);

                if (oldIndex !== -1 && newIndex !== -1) {
                    const newOrder = arrayMove(orderedIds, oldIndex, newIndex);
                    await reorderColumns(boardId!, newOrder);
                }
            }

            return;
        }

        // Ticket movement
        const dest = dragDestRef.current;

        dragDestRef.current = null;

        if (!over || !dest) {
            setLocalTickets(null);
            return;
        }

        const activeId = active.id as string;

        await moveTicket(boardId!, activeId, dest.columnId, dest.index);

        setTimeout(() => setLocalTickets(null), 0);
    }

    async function handleAddColumn(name: string) {
        if (!name.trim()) { setAddingColumn(false); return; }
        await createColumn(boardId!, name.trim());
        setAddingColumn(false);
    }

    return (
        <div className={styles.wrapper}>
            <div className={styles.topbar}>
                <h1 className={styles.boardName}>{board?.name ?? ''}</h1>
                <div className={styles.spacer} />
                <button
                    className={styles.configBtn}
                    onClick={() => setIsEditingBoard(true)}
                    title={t('board.edit')}
                >
                    <Settings size={18} />
                </button>
            </div>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
            >
                <div className={styles.columnsArea}>
                    {loading && !columns.length ? (
                        <div className={styles.loadingColumns}>
                            {[1, 2, 3].map(i => <div key={i} className={styles.skeleton} />)}
                        </div>
                    ) : (
                        <SortableContext
                            items={sortedColumns.map(col => col.id)}
                            strategy={horizontalListSortingStrategy}
                        >
                            <>
                                {sortedColumns.map(col => (
                                    <Column
                                        key={col.id}
                                        column={col}
                                        tickets={getTicketsForColumn(col.id)}
                                        boardId={boardId!}
                                    />
                                ))}

                                {addingColumn ? (
                                    <div className={styles.newColumn}>
                                        <InlineEdit
                                            defaultValue=""
                                            placeholder={t('column.rename_placeholder')}
                                            onSave={handleAddColumn}
                                            onCancel={() => setAddingColumn(false)}
                                            className={styles.newColumnInput}
                                        />
                                    </div>
                                ) : (
                                    <button className={styles.addColBtn} onClick={() => setAddingColumn(true)}>
                                        <Plus size={15} />
                                        {t('column.add')}
                                    </button>
                                )}
                            </>
                        </SortableContext>
                    )}
                </div>

                <DragOverlay dropAnimation={null}>
                    {activeColumn ? (
                        <div className={styles.columnDragGhost} />
                    ) : activeTicket ? (
                        <TicketCard ticket={activeTicket} isOverlay />
                    ) : null}
                </DragOverlay>
            </DndContext>

            {selectedTicket && (
                <TicketModal
                    ticket={selectedTicket}
                    onClose={() => navigate(`/boards/${boardId}`)}
                />
            )}

            {isEditingBoard && board && (
                <BoardModal
                    board={board}
                    onSave={async (name, workspaces) => {
                        await updateBoard(board.id, name, workspaces);
                        setIsEditingBoard(false);
                    }}
                    onCancel={() => setIsEditingBoard(false)}
                />
            )}
        </div>
    );
}
