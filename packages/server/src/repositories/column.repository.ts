import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import type { Column } from '../types.js';

export const columnRepository = {
    findByBoardId(boardId: string): Column[] {
        return getDb()
            .prepare('SELECT * FROM columns WHERE board_id = ? ORDER BY position ASC')
            .all(boardId) as unknown as Column[];
    },

    findById(id: string): Column | undefined {
        return getDb().prepare('SELECT * FROM columns WHERE id = ?').get(id) as Column | undefined;
    },

    create(boardId: string, name: string): Column {
        const id = randomUUID();
        const maxPos = (getDb()
            .prepare('SELECT COALESCE(MAX(position), -1) as m FROM columns WHERE board_id = ?')
            .get(boardId) as { m: number }).m;
        getDb()
            .prepare('INSERT INTO columns (id, board_id, name, position) VALUES (?, ?, ?, ?)')
            .run(id, boardId, name, maxPos + 1);
        return this.findById(id)!;
    },

    update(id: string, name: string): Column | undefined {
        getDb().prepare('UPDATE columns SET name = ? WHERE id = ?').run(name, id);
        return this.findById(id);
    },

    reorder(boardId: string, orderedIds: string[]): void {
        const update = getDb().prepare('UPDATE columns SET position = ? WHERE id = ? AND board_id = ?');
        const transaction = getDb().transaction(() => {
            orderedIds.forEach((id, index) => update.run(index, id, boardId));
        });
        transaction();
    },

    delete(id: string): void {
        getDb().prepare('DELETE FROM columns WHERE id = ?').run(id);
    },
};
