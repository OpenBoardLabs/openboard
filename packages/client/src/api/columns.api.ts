import { API_BASE_URL } from '../constants';
import type { Column } from '../types';

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

export const columnsApi = {
    getByBoard: (boardId: string) =>
        request<Column[]>(`/boards/${boardId}/columns`),
    create: (boardId: string, name: string) =>
        request<Column>(`/boards/${boardId}/columns`, {
            method: 'POST',
            body: JSON.stringify({ name }),
        }),
    update: (boardId: string, id: string, name: string) =>
        request<Column>(`/boards/${boardId}/columns/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name }),
        }),
    reorder: (boardId: string, orderedIds: string[]) =>
        request<void>(`/boards/${boardId}/columns/reorder`, {
            method: 'PUT',
            body: JSON.stringify({ orderedIds }),
        }),
    delete: (boardId: string, id: string) =>
        request<void>(`/boards/${boardId}/columns/${id}`, { method: 'DELETE' }),
};
