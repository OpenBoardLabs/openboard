import { API_BASE_URL } from '../constants';

interface DirectoryEntry {
    name: string;
    path: string;
    isRepo: boolean;
    hasSrc: boolean;
    hasPublic: boolean;
    isDir: boolean;
}

interface BrowseResponse {
    currentPath: string;
    entries: DirectoryEntry[];
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE_URL}/system${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
}

export const systemApi = {
    browse: (path: string) => request<BrowseResponse>(`/browse?path=${encodeURIComponent(path)}`),
    search: (query: string, basePath: string) => 
        request<DirectoryEntry[]>(`/search?query=${encodeURIComponent(query)}&basePath=${encodeURIComponent(basePath)}`),
    searchGlobal: (query: string) => 
        request<DirectoryEntry[]>(`/search/global?query=${encodeURIComponent(query)}`),
};
