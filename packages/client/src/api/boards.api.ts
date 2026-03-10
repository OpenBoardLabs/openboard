import { API_BASE_URL } from '../constants';
import type { Board, BoardWorkspace } from '../types';

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

export const boardsApi = {
    getAll: () => request<Board[]>('/boards'),
    create: (name: string, workspaces: Omit<BoardWorkspace, 'id' | 'board_id'>[] = []) =>
        request<Board>('/boards', {
            method: 'POST',
            body: JSON.stringify({ name, workspaces })
        }),
    update: (id: string, name?: string, workspaces?: Omit<BoardWorkspace, 'id' | 'board_id'>[]) =>
        request<Board>(`/boards/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name, workspaces })
        }),
    delete: (id: string) =>
        request<void>(`/boards/${id}`, { method: 'DELETE' }),
};
