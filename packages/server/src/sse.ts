import type { Response } from 'express';

type SseClient = Response;

class SseManager {
    // boardId -> set of connected SSE clients
    // Use '*' for board-level events (created/deleted) that all clients should see
    private clients: Map<string, Set<SseClient>> = new Map();

    subscribe(boardId: string, res: SseClient): void {
        if (!this.clients.has(boardId)) {
            this.clients.set(boardId, new Set());
        }
        this.clients.get(boardId)!.add(res);
    }

    unsubscribe(boardId: string, res: SseClient): void {
        this.clients.get(boardId)?.delete(res);
    }

    emit(boardId: string, event: string, data: unknown): void {
        const targets = new Set<SseClient>();

        // Collect subscribers for the specific board
        this.clients.get(boardId)?.forEach(c => targets.add(c));
        // Always also broadcast to '*' channel (global subscribers)
        this.clients.get('*')?.forEach(c => targets.add(c));

        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        targets.forEach(client => {
            try {
                client.write(payload);
            } catch {
                // Client disconnected — cleanup handled by 'close' event
            }
        });
    }

    /** Broadcast to ALL connected clients (used for board-level events). */
    emitGlobal(event: string, data: unknown): void {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        this.clients.forEach(set => {
            set.forEach(client => {
                try {
                    client.write(payload);
                } catch { /* ignore */ }
            });
        });
    }
}

export const sseManager = new SseManager();
