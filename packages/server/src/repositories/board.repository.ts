import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import type { Board, BoardWorkspace } from '../types.js';

export const boardRepository = {
    findAll(): Board[] {
        const db = getDb();
        const boards = db.prepare('SELECT * FROM boards ORDER BY created_at ASC').all() as unknown as Board[];
        return boards.map(board => {
            const workspaces = db.prepare('SELECT * FROM board_workspaces WHERE board_id = ?').all(board.id) as unknown as BoardWorkspace[];
            return {
                ...board,
                workspaces
            };
        });
    },

    findById(id: string): Board | undefined {
        const db = getDb();
        const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(id) as Board | undefined;
        if (!board) return undefined;
        const workspaces = db.prepare('SELECT * FROM board_workspaces WHERE board_id = ?').all(id) as unknown as BoardWorkspace[];
        return {
            ...board,
            workspaces
        };
    },

    findByPath(path: string): Board | undefined {
        const db = getDb();
        const board = db.prepare('SELECT * FROM boards WHERE path = ?').get(path) as Board | undefined;
        if (!board) return undefined;
        const workspaces = db.prepare('SELECT * FROM board_workspaces WHERE board_id = ?').all(board.id) as unknown as BoardWorkspace[];
        return {
            ...board,
            workspaces
        };
    },

    create(name: string, path?: string, workspaces: Omit<BoardWorkspace, 'id' | 'board_id'>[] = []): Board {
        const boardId = randomUUID();
        const db = getDb();

        db.transaction(() => {
            db.prepare('INSERT INTO boards (id, name, path) VALUES (?, ?, ?)').run(boardId, name, path || null);
            for (const ws of workspaces) {
                db.prepare('INSERT INTO board_workspaces (id, board_id, type, path) VALUES (?, ?, ?, ?)')
                    .run(randomUUID(), boardId, ws.type, ws.path);
            }
        })();

        return this.findById(boardId)!;
    },

    update(id: string, name: string, path?: string | null, workspaces?: Omit<BoardWorkspace, 'id' | 'board_id'>[]): Board | undefined {
        const db = getDb();

        db.transaction(() => {
            if (path !== undefined) {
                db.prepare('UPDATE boards SET name = ?, path = ? WHERE id = ?').run(name, path, id);
            } else {
                db.prepare('UPDATE boards SET name = ? WHERE id = ?').run(name, id);
            }

            if (workspaces) {
                // Simple sync: delete all and re-create
                db.prepare('DELETE FROM board_workspaces WHERE board_id = ?').run(id);
                for (const ws of workspaces) {
                    db.prepare('INSERT INTO board_workspaces (id, board_id, type, path) VALUES (?, ?, ?, ?)')
                        .run(randomUUID(), id, ws.type, ws.path);
                }
            }
        })();

        return this.findById(id);
    },

    delete(id: string): void {
        getDb().prepare('DELETE FROM boards WHERE id = ?').run(id);
    },
};
