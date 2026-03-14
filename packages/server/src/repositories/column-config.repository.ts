import { getDb } from '../db/database.js';
import type { ColumnConfig, AgentType, CoderType } from '../types.js';

export const columnConfigRepository = {
    findByColumnId(columnId: string): ColumnConfig | undefined {
        const row = getDb()
            .prepare('SELECT * FROM column_configs WHERE column_id = ?')
            .get(columnId) as (ColumnConfig & { coder_type?: string | null; reviewer_type?: string | null }) | undefined;
        if (!row) return undefined;
        const rawCoderType = row.coder_type as string | null | undefined;
        if (row.agent_type === 'coder' && (rawCoderType == null || String(rawCoderType).trim() === '')) {
            (row as ColumnConfig).coder_type = 'opencode';
        }
        const rawReviewerType = row.reviewer_type as string | null | undefined;
        if (row.agent_type === 'code_review' && (rawReviewerType == null || String(rawReviewerType).trim() === '')) {
            (row as ColumnConfig).reviewer_type = 'opencode';
        }
        return row as ColumnConfig;
    },

    findByBoardId(boardId: string): ColumnConfig[] {
        const rows = getDb()
            .prepare(`
                SELECT cf.* FROM column_configs cf
                JOIN columns c ON cf.column_id = c.id
                WHERE c.board_id = ?
            `)
            .all(boardId) as unknown as (ColumnConfig & { coder_type?: string | null })[];
        return rows.map(row => {
            const rawCoderType = row.coder_type as string | null | undefined;
            if (row.agent_type === 'coder' && (rawCoderType == null || String(rawCoderType).trim() === '')) {
                (row as ColumnConfig).coder_type = 'opencode';
            }
            const rawReviewerType = row.reviewer_type as string | null | undefined;
            if (row.agent_type === 'code_review' && (rawReviewerType == null || String(rawReviewerType).trim() === '')) {
                (row as ColumnConfig).reviewer_type = 'opencode';
            }
            return row as ColumnConfig;
        });
    },

    upsert(data: {
        columnId: string;
        agentType: AgentType;
        coderType?: CoderType | null;
        reviewerType?: CoderType | null;
        maxAgents?: number;
        reviewMode?: 'pr' | 'local';
        onFinishColumnId?: string | null;
        onRejectColumnId?: string | null;
    }): ColumnConfig {
        const coderType = data.agentType === 'coder' ? (data.coderType ?? 'opencode') : null;
        const reviewerType = data.agentType === 'code_review' ? (data.reviewerType ?? 'opencode') : null;
        getDb()
            .prepare(
                `INSERT OR REPLACE INTO column_configs (column_id, agent_type, coder_type, reviewer_type, agent_model, max_agents, review_mode, on_finish_column_id, on_reject_column_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(data.columnId, data.agentType, coderType, reviewerType, null, data.maxAgents ?? 1, data.reviewMode ?? 'pr', data.onFinishColumnId ?? null, data.onRejectColumnId ?? null);
        return this.findByColumnId(data.columnId)!;
    },

    delete(columnId: string): void {
        getDb()
            .prepare('DELETE FROM column_configs WHERE column_id = ?')
            .run(columnId);
    },
};
