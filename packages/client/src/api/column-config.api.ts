import { API_BASE_URL } from '../constants';
import type { ColumnConfig, AgentType, CoderType } from '../types';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE_URL}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (!res.ok) {
        if (res.status === 404) return null as T;
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
}

export const columnConfigApi = {
    getAllConfigs: (boardId: string) =>
        request<ColumnConfig[]>(`/boards/${boardId}/columns/configs`),
    getConfig: (boardId: string, columnId: string) =>
        request<ColumnConfig | null>(`/boards/${boardId}/columns/${columnId}/config`),
    upsert: (boardId: string, columnId: string, data: { agentType: AgentType; coderType?: CoderType | null; reviewerType?: CoderType | null; maxAgents?: number; reviewMode?: 'pr' | 'local'; onFinishColumnId?: string | null; onRejectColumnId?: string | null }) =>
        request<ColumnConfig>(`/boards/${boardId}/columns/${columnId}/config`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    delete: (boardId: string, columnId: string) =>
        request<void>(`/boards/${boardId}/columns/${columnId}/config`, { method: 'DELETE' }),
};
