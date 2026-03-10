import React, { createContext, useContext, useReducer, useCallback } from 'react';
import type { Board, Column, Ticket } from '../types';
import { boardsApi } from '../api/boards.api';
import { columnsApi } from '../api/columns.api';
import { ticketsApi } from '../api/tickets.api';
import { commentsApi } from '../api/comments.api';
import { columnConfigApi } from '../api/column-config.api';
import type { Priority, Comment, ColumnConfig, AgentType, BoardWorkspace } from '../types';
import { useSSE } from '../hooks/useSSE';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------
interface AppState {
    boards: Board[];
    activeBoardId: string | null;
    columns: Column[];       // columns for active board
    tickets: Ticket[];       // tickets for active board
    columnConfigs: ColumnConfig[];
    comments: Record<string, Comment[]>; // ticketId -> comments
    loading: boolean;
    error: string | null;
}

const initialState: AppState = {
    boards: [],
    activeBoardId: null,
    columns: [],
    tickets: [],
    columnConfigs: [],
    comments: {},
    loading: false,
    error: null,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
type Action =
    | { type: 'SET_LOADING'; payload: boolean }
    | { type: 'SET_ERROR'; payload: string | null }
    | { type: 'SET_BOARDS'; payload: Board[] }
    | { type: 'ADD_BOARD'; payload: Board }
    | { type: 'UPDATE_BOARD'; payload: Board }
    | { type: 'DELETE_BOARD'; payload: string }
    | { type: 'SET_ACTIVE_BOARD'; payload: string | null }
    | { type: 'SET_COLUMNS'; payload: Column[] }
    | { type: 'ADD_COLUMN'; payload: Column }
    | { type: 'UPDATE_COLUMN'; payload: Column }
    | { type: 'DELETE_COLUMN'; payload: string }
    | { type: 'SET_TICKETS'; payload: Ticket[] }
    | { type: 'ADD_TICKET'; payload: Ticket }
    | { type: 'UPDATE_TICKET'; payload: Ticket }
    | { type: 'DELETE_TICKET'; payload: string }
    | { type: 'MOVE_TICKET'; payload: { ticketId: string; toColumnId: string; position: number } }
    | { type: 'SET_COMMENTS'; payload: { ticketId: string; comments: Comment[] } }
    | { type: 'ADD_COMMENT'; payload: { ticketId: string; comment: Comment } }
    | { type: 'UPDATE_COMMENT'; payload: { ticketId: string; comment: Comment } }
    | { type: 'SET_COLUMN_CONFIGS'; payload: ColumnConfig[] }
    | { type: 'UPDATE_COLUMN_CONFIG'; payload: ColumnConfig }
    | { type: 'DELETE_COLUMN_CONFIG'; payload: string };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------
function reducer(state: AppState, action: Action): AppState {
    switch (action.type) {
        case 'SET_LOADING': return { ...state, loading: action.payload };
        case 'SET_ERROR': return { ...state, error: action.payload };
        case 'SET_BOARDS': return { ...state, boards: action.payload };
        case 'ADD_BOARD': {
            const exists = state.boards.some(b => b.id === action.payload.id);
            return {
                ...state, boards: exists
                    ? state.boards.map(b => b.id === action.payload.id ? action.payload : b)
                    : [...state.boards, action.payload]
            };
        }
        case 'UPDATE_BOARD':
            return { ...state, boards: state.boards.map(b => b.id === action.payload.id ? action.payload : b) };
        case 'DELETE_BOARD': {
            const boards = state.boards.filter(b => b.id !== action.payload);
            const activeBoardId = state.activeBoardId === action.payload
                ? (boards[0]?.id ?? null)
                : state.activeBoardId;
            return { ...state, boards, activeBoardId, columns: activeBoardId === action.payload ? [] : state.columns, tickets: activeBoardId === action.payload ? [] : state.tickets };
        }
        case 'SET_ACTIVE_BOARD': return { ...state, activeBoardId: action.payload, columns: [], tickets: [] };
        case 'SET_COLUMNS': return { ...state, columns: action.payload };
        case 'ADD_COLUMN': {
            const exists = state.columns.some(c => c.id === action.payload.id);
            return {
                ...state, columns: exists
                    ? state.columns.map(c => c.id === action.payload.id ? action.payload : c)
                    : [...state.columns, action.payload]
            };
        }
        case 'UPDATE_COLUMN':
            return { ...state, columns: state.columns.map(c => c.id === action.payload.id ? action.payload : c) };
        case 'DELETE_COLUMN':
            return {
                ...state,
                columns: state.columns.filter(c => c.id !== action.payload),
                tickets: state.tickets.filter(t => t.column_id !== action.payload),
            };
        case 'SET_TICKETS': return { ...state, tickets: action.payload };
        case 'ADD_TICKET': {
            const exists = state.tickets.some(t => t.id === action.payload.id);
            return {
                ...state, tickets: exists
                    ? state.tickets.map(t => t.id === action.payload.id ? action.payload : t)
                    : [...state.tickets, action.payload]
            };
        }
        case 'UPDATE_TICKET': {
            const exists = state.tickets.some(t => t.id === action.payload.id);
            if (!exists) {
                return { ...state, tickets: [...state.tickets, action.payload] };
            }
            return { ...state, tickets: state.tickets.map(t => t.id === action.payload.id ? action.payload : t) };
        }
        case 'DELETE_TICKET':
            return { ...state, tickets: state.tickets.filter(t => t.id !== action.payload) };
        case 'MOVE_TICKET': {
            const { ticketId, toColumnId, position } = action.payload;
            const ticket = state.tickets.find(t => t.id === ticketId);
            if (!ticket) return state;
            const updated = { ...ticket, column_id: toColumnId, position };
            return { ...state, tickets: state.tickets.map(t => t.id === ticketId ? updated : t) };
        }
        case 'SET_COMMENTS':
            return { ...state, comments: { ...state.comments, [action.payload.ticketId]: action.payload.comments } };
        case 'ADD_COMMENT': {
            const existing = state.comments[action.payload.ticketId] ?? [];
            if (existing.some(c => c.id === action.payload.comment.id)) return state;
            return {
                ...state,
                comments: {
                    ...state.comments,
                    [action.payload.ticketId]: [...existing, action.payload.comment]
                }
            };
        }
        case 'UPDATE_COMMENT': {
            const existing = state.comments[action.payload.ticketId] ?? [];
            return {
                ...state,
                comments: {
                    ...state.comments,
                    [action.payload.ticketId]: existing.map(c =>
                        c.id === action.payload.comment.id ? action.payload.comment : c
                    )
                }
            };
        }
        case 'SET_COLUMN_CONFIGS': return { ...state, columnConfigs: action.payload };
        case 'UPDATE_COLUMN_CONFIG': {
            const exists = state.columnConfigs.some(c => c.column_id === action.payload.column_id);
            return {
                ...state,
                columnConfigs: exists
                    ? state.columnConfigs.map(c => c.column_id === action.payload.column_id ? action.payload : c)
                    : [...state.columnConfigs, action.payload]
            };
        }
        case 'DELETE_COLUMN_CONFIG':
            return { ...state, columnConfigs: state.columnConfigs.filter(c => c.column_id !== action.payload) };
        default: return state;
    }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
interface AppContextValue {
    state: AppState;
    loadBoards: () => Promise<void>;
    loadBoardData: (boardId: string) => Promise<void>;
    selectBoard: (boardId: string) => void;
    createBoard: (name: string, workspaces?: Omit<BoardWorkspace, 'id' | 'board_id'>[]) => Promise<Board>;
    updateBoard: (id: string, name?: string, workspaces?: Omit<BoardWorkspace, 'id' | 'board_id'>[]) => Promise<void>;
    deleteBoard: (id: string) => Promise<void>;
    createColumn: (boardId: string, name: string) => Promise<void>;
    updateColumn: (boardId: string, id: string, name: string) => Promise<void>;
    reorderColumns: (boardId: string, orderedIds: string[]) => Promise<void>;
    deleteColumn: (boardId: string, id: string) => Promise<void>;
    createTicket: (boardId: string, data: { columnId: string; title: string; description?: string; priority?: Priority }) => Promise<Ticket>;
    updateTicket: (boardId: string, id: string, data: Partial<{ title: string; description: string; priority: Priority }>) => Promise<void>;
    moveTicket: (boardId: string, id: string, toColumnId: string, position: number) => Promise<void>;
    deleteTicket: (boardId: string, id: string) => Promise<void>;
    retryTicket: (boardId: string, id: string) => Promise<void>;
    loadColumnConfigs: (boardId: string) => Promise<void>;
    loadComments: (boardId: string, ticketId: string) => Promise<void>;
    addComment: (boardId: string, ticketId: string, content: string, author?: string) => Promise<void>;
    updateColumnConfig: (boardId: string, columnId: string, data: { agentType: AgentType; agentModel?: string | null; maxAgents?: number; onFinishColumnId?: string | null }) => Promise<void>;
    deleteColumnConfig: (boardId: string, columnId: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
    const [state, dispatch] = useReducer(reducer, initialState);

    // Real-time sync: listen for server-pushed SSE events for the active board.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useSSE(state.activeBoardId, dispatch as any);

    const loadBoards = useCallback(async () => {
        dispatch({ type: 'SET_LOADING', payload: true });
        try {
            const boards = await boardsApi.getAll();
            dispatch({ type: 'SET_BOARDS', payload: boards });
        } catch {
            dispatch({ type: 'SET_ERROR', payload: 'error.load' });
        } finally {
            dispatch({ type: 'SET_LOADING', payload: false });
        }
    }, []);

    const loadBoardData = useCallback(async (boardId: string) => {
        dispatch({ type: 'SET_LOADING', payload: true });
        try {
            const [columns, tickets, configs] = await Promise.all([
                columnsApi.getByBoard(boardId),
                ticketsApi.getByBoard(boardId),
                columnConfigApi.getAllConfigs(boardId),
            ]);
            dispatch({ type: 'SET_COLUMNS', payload: columns });
            dispatch({ type: 'SET_TICKETS', payload: tickets });
            dispatch({ type: 'SET_COLUMN_CONFIGS', payload: configs });
        } catch {
            dispatch({ type: 'SET_ERROR', payload: 'error.load' });
        } finally {
            dispatch({ type: 'SET_LOADING', payload: false });
        }
    }, []);

    const selectBoard = useCallback((boardId: string) => {
        dispatch({ type: 'SET_ACTIVE_BOARD', payload: boardId });
    }, []);

    const createBoard = useCallback(async (name: string, workspaces: Omit<BoardWorkspace, 'id' | 'board_id'>[] = []) => {
        const board = await boardsApi.create(name, workspaces);
        dispatch({ type: 'ADD_BOARD', payload: board });
        return board;
    }, []);

    const updateBoard = useCallback(async (id: string, name?: string, workspaces?: Omit<BoardWorkspace, 'id' | 'board_id'>[]) => {
        const board = await boardsApi.update(id, name, workspaces);
        dispatch({ type: 'UPDATE_BOARD', payload: board });
    }, []);

    const deleteBoard = useCallback(async (id: string) => {
        await boardsApi.delete(id);
        dispatch({ type: 'DELETE_BOARD', payload: id });
    }, []);

    const createColumn = useCallback(async (boardId: string, name: string) => {
        const column = await columnsApi.create(boardId, name);
        dispatch({ type: 'ADD_COLUMN', payload: column });
    }, []);

    const updateColumn = useCallback(async (boardId: string, id: string, name: string) => {
        const column = await columnsApi.update(boardId, id, name);
        dispatch({ type: 'UPDATE_COLUMN', payload: column });
    }, []);

    const reorderColumns = useCallback(async (boardId: string, orderedIds: string[]) => {
        await columnsApi.reorder(boardId, orderedIds);
    }, []);

    const deleteColumn = useCallback(async (boardId: string, id: string) => {
        await columnsApi.delete(boardId, id);
        dispatch({ type: 'DELETE_COLUMN', payload: id });
    }, []);

    const createTicket = useCallback(async (boardId: string, data: Parameters<AppContextValue['createTicket']>[1]) => {
        const ticket = await ticketsApi.create(boardId, data);
        dispatch({ type: 'ADD_TICKET', payload: ticket });
        return ticket;
    }, []);

    const updateTicket = useCallback(async (boardId: string, id: string, data: Parameters<AppContextValue['updateTicket']>[2]) => {
        const ticket = await ticketsApi.update(boardId, id, data);
        dispatch({ type: 'UPDATE_TICKET', payload: ticket });
    }, []);

    const moveTicket = useCallback(async (boardId: string, id: string, toColumnId: string, position: number) => {
        dispatch({ type: 'MOVE_TICKET', payload: { ticketId: id, toColumnId, position } });
        await ticketsApi.move(boardId, id, toColumnId, position);
    }, []);

    const deleteTicket = useCallback(async (boardId: string, id: string) => {
        await ticketsApi.delete(boardId, id);
        dispatch({ type: 'DELETE_TICKET', payload: id });
    }, []);

    const retryTicket = useCallback(async (boardId: string, id: string) => {
        await ticketsApi.retry(boardId, id);
    }, []);

    const loadColumnConfigs = useCallback(async (boardId: string) => {
        const configs = await columnConfigApi.getAllConfigs(boardId);
        dispatch({ type: 'SET_COLUMN_CONFIGS', payload: configs });
    }, []);

    const loadComments = useCallback(async (boardId: string, ticketId: string) => {
        const comments = await commentsApi.getByTicket(boardId, ticketId);
        dispatch({ type: 'SET_COMMENTS', payload: { ticketId, comments } });
    }, []);

    const addComment = useCallback(async (boardId: string, ticketId: string, content: string, author?: string) => {
        const comment = await commentsApi.create(boardId, ticketId, { content, author });
        dispatch({ type: 'ADD_COMMENT', payload: { ticketId, comment } });
    }, []);

    const updateColumnConfig = useCallback(async (boardId: string, columnId: string, data: Parameters<AppContextValue['updateColumnConfig']>[2]) => {
        const config = await columnConfigApi.upsert(boardId, columnId, data);
        dispatch({ type: 'UPDATE_COLUMN_CONFIG', payload: config });
    }, []);

    const deleteColumnConfig = useCallback(async (boardId: string, columnId: string) => {
        await columnConfigApi.delete(boardId, columnId);
        dispatch({ type: 'DELETE_COLUMN_CONFIG', payload: columnId });
    }, []);

    return (
        <AppContext.Provider value={{
            state, loadBoards, loadBoardData, selectBoard,
            createBoard, updateBoard, deleteBoard,
            createColumn, updateColumn, reorderColumns, deleteColumn,
            createTicket, updateTicket, moveTicket, deleteTicket, retryTicket,
            loadColumnConfigs, loadComments, addComment, updateColumnConfig, deleteColumnConfig,
        }}>
            {children}
        </AppContext.Provider>
    );
}

export function useApp(): AppContextValue {
    const ctx = useContext(AppContext);
    if (!ctx) throw new Error('useApp must be used inside AppProvider');
    return ctx;
}
