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
            status: 'processing' | 'done' | 'blocked' | 'needs_approval';
            url?: string;
            pr_url?: string;
            worktree_path?: string;
            port?: number;
            error_message?: string;
            total_cost?: number;
            merged?: boolean;
        }
    ): Ticket | undefined {
        const ticket = this.findById(id);
        if (!ticket) return undefined;

        const sessions = [...ticket.agent_sessions];

        // Find the index of the most recent session for this column
        let existingIdx = -1;
        for (let i = sessions.length - 1; i >= 0; i--) {
            if (sessions[i].column_id === sessionData.column_id) {
                existingIdx = i;
                break;
            }
        }

        const isTerminalStatus = (s: string) => s === 'done' || s === 'blocked';
        let isNewSession = false;

        if (existingIdx === -1) {
            // No session ever Existed for this column
            isNewSession = true;
        } else {
            const existingSession = sessions[existingIdx];
            // If the existing session is already in a terminal state (done or blocked)
            // AND we are trying to start a new 'processing' session, then we append.
            if (isTerminalStatus(existingSession.status) && sessionData.status === 'processing') {
                isNewSession = true;
            }
        }

        if (isNewSession) {
            const newSession = {
                ...sessionData,
                started_at: new Date().toISOString(),
                // If it starts terminal (which would be weird but possible), set finished_at
                finished_at: isTerminalStatus(sessionData.status) ? new Date().toISOString() : undefined
            };
            sessions.push(newSession);
        } else {
            // Update the existing (active) session
            const newSession = {
                ...sessions[existingIdx], // Preserve started_at and any missing fields
                ...sessionData,
                finished_at: isTerminalStatus(sessionData.status) ? new Date().toISOString() : undefined
            };
            sessions[existingIdx] = newSession;
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
