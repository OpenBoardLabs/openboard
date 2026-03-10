import { API_BASE_URL } from '../constants';
import type { Ticket, Priority } from '../types';

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

export const ticketsApi = {
    getByBoard: (boardId: string) =>
        request<Ticket[]>(`/boards/${boardId}/tickets`),
    create: (boardId: string, data: { columnId: string; title: string; description?: string; priority?: Priority }) =>
        request<Ticket>(`/boards/${boardId}/tickets`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (boardId: string, id: string, data: Partial<{ title: string; description: string; priority: Priority }>) =>
        request<Ticket>(`/boards/${boardId}/tickets/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        }),
    move: (boardId: string, id: string, toColumnId: string, position: number) =>
        request<Ticket>(`/boards/${boardId}/tickets/${id}/move`, {
            method: 'PUT',
            body: JSON.stringify({ toColumnId, position }),
        }),
    delete: (boardId: string, id: string) =>
        request<void>(`/boards/${boardId}/tickets/${id}`, { method: 'DELETE' }),
    retry: (boardId: string, id: string) =>
        request<void>(`/boards/${boardId}/tickets/${id}/retry`, { method: 'POST' }),
};
