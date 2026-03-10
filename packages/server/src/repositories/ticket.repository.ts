import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import { sseManager } from '../sse.js';
import type { Ticket, Priority } from '../types.js';

function parseTicket(row: any): Ticket {
    let agent_sessions = [];
    if (row.agent_sessions) {
        try {
            agent_sessions = JSON.parse(row.agent_sessions);
        } catch { }
    }
    return {
        ...row,
        agent_sessions
    };
}


export const ticketRepository = {
    findByColumnId(columnId: string): Ticket[] {
        const rows = getDb()
            .prepare('SELECT * FROM tickets WHERE column_id = ? ORDER BY position ASC')
            .all(columnId) as any[];
        return rows.map(parseTicket);
    },

    findByBoardId(boardId: string): Ticket[] {
        const rows = getDb()
            .prepare('SELECT * FROM tickets WHERE board_id = ? ORDER BY position ASC')
            .all(boardId) as any[];
        return rows.map(parseTicket);
    },

    findById(id: string): Ticket | undefined {
        const row = getDb().prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
        if (!row) return undefined;
        return parseTicket(row);
    },

    create(data: {
        columnId: string;
        boardId: string;
        title: string;
        description?: string;
        priority?: Priority;
    }): Ticket {
        const id = randomUUID();
        const maxPos = (getDb()
            .prepare('SELECT COALESCE(MAX(position), -1) as m FROM tickets WHERE column_id = ?')
            .get(data.columnId) as { m: number }).m;

        getDb()
            .prepare(
                `INSERT INTO tickets (id, column_id, board_id, title, description, priority, position)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                id,
                data.columnId,
                data.boardId,
                data.title,
                data.description ?? '',
                data.priority ?? 'medium',
                maxPos + 1
            );

        const savedTicket = this.findById(id)!;
        sseManager.emit(savedTicket.board_id, 'ticket:updated', savedTicket);
        return savedTicket;
    },

    update(
        id: string,
        data: Partial<{ title: string; description: string; priority: Priority }>
    ): Ticket | undefined {
        const ticket = this.findById(id);
        if (!ticket) return undefined;

        const updated = { ...ticket, ...data, updated_at: new Date().toISOString() };
        getDb()
            .prepare(
                `UPDATE tickets SET title = ?, description = ?, priority = ?, updated_at = ? WHERE id = ?`
            )
            .run(updated.title, updated.description, updated.priority, updated.updated_at, id);

        const savedTicket = this.findById(id);
        if (savedTicket) {
            sseManager.emit(savedTicket.board_id, 'ticket:updated', savedTicket);
        }
        return savedTicket;
    },

    move(id: string, toColumnId: string, position: number): Ticket | undefined {
        const db = getDb();

        const existing = db.prepare('SELECT column_id, position FROM tickets WHERE id = ?').get(id) as { column_id: string, position: number } | undefined;
        if (!existing) return undefined;

        const fromColumnId = existing.column_id;
        const fromPosition = existing.position;

        db.transaction(() => {
            if (fromColumnId === toColumnId) {
                // Moving within same column
                if (fromPosition === position) return; // No-op

                if (fromPosition < position) {
                    // Moving down: shift items between old and new position up
                    db.prepare(
                        'UPDATE tickets SET position = position - 1 WHERE column_id = ? AND position > ? AND position <= ?'
                    ).run(toColumnId, fromPosition, position);
                } else {
                    // Moving up: shift items between new and old position down
                    db.prepare(
                        'UPDATE tickets SET position = position + 1 WHERE column_id = ? AND position >= ? AND position < ?'
                    ).run(toColumnId, position, fromPosition);
                }
            } else {
                // Moving to different column
                // 1. Shift items in destination column down to make room
                db.prepare(
                    'UPDATE tickets SET position = position + 1 WHERE column_id = ? AND position >= ?'
                ).run(toColumnId, position);

                // 2. Clear gaps in source column
                db.prepare(
                    'UPDATE tickets SET position = position - 1 WHERE column_id = ? AND position > ?'
                ).run(fromColumnId, fromPosition);
            }

            // Finally, update the target ticket (agent history remains intact)
            db.prepare(
                `UPDATE tickets SET column_id = ?, position = ?, updated_at = datetime('now') WHERE id = ?`
            ).run(toColumnId, position, id);
        })();

        const updatedTicket = this.findById(id);
        if (updatedTicket) {
            sseManager.emit(updatedTicket.board_id, 'ticket:updated', updatedTicket);
        }
        return updatedTicket;
    },

    updateAgentSession(
        id: string,
        sessionData: {
            column_id: string;
            agent_type: string;
            status: 'processing' | 'done' | 'blocked';
            url?: string;
            port?: number;
            error_message?: string;
        }
    ): Ticket | undefined {
        const ticket = this.findById(id);
        if (!ticket) return undefined;

        // Find existing session for this column or create a new one
        const sessions = [...ticket.agent_sessions];
        const existingIdx = sessions.findIndex(s => s.column_id === sessionData.column_id);

        const newSession = {
            ...sessionData,
            started_at: existingIdx >= 0 ? sessions[existingIdx].started_at : new Date().toISOString(),
            finished_at: (sessionData.status === 'done' || sessionData.status === 'blocked') ? new Date().toISOString() : undefined
        };

        if (existingIdx >= 0) {
            sessions[existingIdx] = newSession;
        } else {
            sessions.push(newSession);
        }

        const updated = { ...ticket, agent_sessions: sessions, updated_at: new Date().toISOString() };

        getDb()
            .prepare('UPDATE tickets SET agent_sessions = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(sessions), updated.updated_at, id);

        const savedTicket = this.findById(id);
        if (savedTicket) {
            sseManager.emit(savedTicket.board_id, 'ticket:updated', savedTicket);
        }
        return savedTicket;
    },

    delete(id: string): void {
        getDb().prepare('DELETE FROM tickets WHERE id = ?').run(id);
    },
};
