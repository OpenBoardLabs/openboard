import { useEffect, useRef } from 'react';
import { API_BASE_URL } from '../constants';
import type { Board, Column, Ticket } from '../types';

// The reducer action type is inferred here so we don't create a circular import.
type Dispatch = (action: { type: string; payload: unknown }) => void;

export function useSSE(boardId: string | null, dispatch: Dispatch) {
    // Keep refs so the effect closure always sees the latest values
    const dispatchRef = useRef(dispatch);
    dispatchRef.current = dispatch;

    useEffect(() => {
        if (!boardId) return;

        // Convert /api base url (http://localhost:4199/api) → SSE url
        const baseOrigin = API_BASE_URL.replace(/\/api$/, '');
        const url = `${baseOrigin}/api/events?boardId=${encodeURIComponent(boardId)}`;

        const es = new EventSource(url);

        const handle = (event: string, handler: (data: unknown) => void) => {
            es.addEventListener(event, (e: MessageEvent) => {
                try {
                    handler(JSON.parse(e.data));
                } catch {
                    // malformed payload — ignore
                }
            });
        };

        // ── Tickets ──────────────────────────────────────────────────────────
        handle('ticket:created', (data) =>
            dispatchRef.current({ type: 'ADD_TICKET', payload: data as Ticket }));

        handle('ticket:updated', (data) => {
            const ticket = data as Ticket;
            dispatchRef.current({ type: 'UPDATE_TICKET', payload: ticket });
        });

        handle('ticket:moved', (data) => {
            const ticket = data as Ticket;
            dispatchRef.current({ type: 'UPDATE_TICKET', payload: ticket });
            dispatchRef.current({ type: 'ADD_AUTO_MOVED_EFFECT', payload: ticket.id });
        });

        handle('ticket:deleted', (data) =>
            dispatchRef.current({ type: 'DELETE_TICKET', payload: (data as { id: string }).id }));

        // ── Columns ───────────────────────────────────────────────────────────
        handle('column:created', (data) =>
            dispatchRef.current({ type: 'ADD_COLUMN', payload: data as Column }));

        handle('column:updated', (data) =>
            dispatchRef.current({ type: 'UPDATE_COLUMN', payload: data as Column }));

        handle('columns:reordered', (data) =>
            dispatchRef.current({ type: 'SET_COLUMNS', payload: data as Column[] }));

        handle('column:deleted', (data) =>
            dispatchRef.current({ type: 'DELETE_COLUMN', payload: (data as { id: string }).id }));

        // ── Boards ────────────────────────────────────────────────────────────
        handle('board:created', (data) =>
            dispatchRef.current({ type: 'ADD_BOARD', payload: data as Board }));

        handle('board:updated', (data) =>
            dispatchRef.current({ type: 'UPDATE_BOARD', payload: data as Board }));

        handle('board:deleted', (data) =>
            dispatchRef.current({ type: 'DELETE_BOARD', payload: (data as { id: string }).id }));

        // ── Agent System ──────────────────────────────────────────────────────
        handle('comment:added', (data) =>
            dispatchRef.current({ type: 'ADD_COMMENT', payload: data as { ticketId: string; comment: any } }));

        handle('comment:updated', (data) =>
            dispatchRef.current({ type: 'UPDATE_COMMENT', payload: data as { ticketId: string; comment: any } }));

        handle('column:config:updated', (data) =>
            dispatchRef.current({ type: 'UPDATE_COLUMN_CONFIG', payload: data as any }));

        handle('column:config:deleted', (data) =>
            dispatchRef.current({ type: 'DELETE_COLUMN_CONFIG', payload: (data as { columnId: string }).columnId }));

        es.onerror = () => {
            // EventSource auto-reconnects on error — no manual retry needed.
            console.warn('[SSE] Connection error; browser will auto-reconnect.');
        };

        return () => {
            es.close();
        };
    }, [boardId]);
}
