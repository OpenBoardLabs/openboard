import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import { sseManager } from '../sse.js';
import type { Comment } from '../types.js';

export const commentRepository = {
    findByTicketId(ticketId: string): Comment[] {
        const db = getDb();
        return db.prepare('SELECT * FROM comments WHERE ticket_id = ? ORDER BY created_at ASC').all(ticketId) as unknown as Comment[];
    },

    create(data: { ticketId: string; author?: string; content: string }): Comment {
        const id = randomUUID();
        const db = getDb();
        db.prepare(
            'INSERT INTO comments (id, ticket_id, author, content) VALUES (?, ?, ?, ?)'
        )
            .run(id, data.ticketId, data.author ?? 'agent', data.content);
        const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as unknown as Comment | undefined;
        if (comment) {
            sseManager.emit(data.ticketId, 'comment:added', {
                ticketId: data.ticketId,
                comment,
            });
        }
        return comment as Comment;
    },

    update(id: string, content: string): Comment | undefined {
        const db = getDb();
        db.prepare('UPDATE comments SET content = ? WHERE id = ?').run(content, id);
        const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as unknown as Comment | undefined;
        if (comment) {
            sseManager.emit(comment.ticket_id, 'comment:updated', {
                ticketId: comment.ticket_id,
                comment,
            });
        }
        return comment;
    },
};
