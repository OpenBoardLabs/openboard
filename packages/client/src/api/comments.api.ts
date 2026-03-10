import { API_BASE_URL } from '../constants';
import type { Comment } from '../types';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE_URL}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
}

export const commentsApi = {
    getByTicket: (boardId: string, ticketId: string) =>
        request<Comment[]>(`/boards/${boardId}/tickets/${ticketId}/comments`),
    create: (boardId: string, ticketId: string, data: { content: string; author?: string }) =>
        request<Comment>(`/boards/${boardId}/tickets/${ticketId}/comments`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),
};
