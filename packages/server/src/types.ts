// Shared types between server and client (duplicated intentionally for zero-dep simplicity)

export type AgentType = 'dummy' | 'none' | 'opencode' | 'code_review';

export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface BoardWorkspace {
    id: string;
    board_id: string;
    type: 'folder' | 'git';
    path: string; // folder path or git url
}

export interface Board {
    id: string;
    name: string;
    workspaces: BoardWorkspace[];
    created_at: string;
}

export interface Column {
    id: string;
    board_id: string;
    name: string;
    position: number;
    created_at: string;
}

export interface AgentSession {
    column_id: string; // The step/column this agent session belongs to
    agent_type: string; // e.g., 'opencode'
    status: 'processing' | 'done' | 'blocked' | 'needs_approval';
    url?: string;
    pr_url?: string;
    port?: number;
    error_message?: string;
    started_at: string;
    finished_at?: string;
}

export interface Ticket {
    id: string;
    column_id: string;
    board_id: string;
    title: string;
    description: string;
    priority: Priority;
    position: number;
    agent_sessions: AgentSession[];

    created_at: string;
    updated_at: string;
}

export interface Comment {
    id: string;
    ticket_id: string;
    author: string;
    content: string;
    created_at: string;
}

export interface ColumnConfig {
    column_id: string;
    agent_type: AgentType;
    agent_model?: string | null;
    max_agents?: number;
    on_finish_column_id: string | null;
}
