import { getDb } from '../db/database.js';
import type { ColumnConfig, AgentType } from '../types.js';

export const columnConfigRepository = {
    findByColumnId(columnId: string): ColumnConfig | undefined {
        return getDb()
            .prepare('SELECT * FROM column_configs WHERE column_id = ?')
            .get(columnId) as ColumnConfig | undefined;
    },

    findByBoardId(boardId: string): ColumnConfig[] {
        // Since board_id is not in column_configs, we join with columns
        return getDb()
            .prepare(`
                SELECT cf.* FROM column_configs cf
                JOIN columns c ON cf.column_id = c.id
                WHERE c.board_id = ?
            `)
            .all(boardId) as unknown as ColumnConfig[];
    },

    upsert(data: {
        columnId: string;
        agentType: AgentType;
        maxAgents?: number;
        onFinishColumnId?: string | null;
        onRejectColumnId?: string | null;
    }): ColumnConfig {
        getDb()
            .prepare(
                `INSERT OR REPLACE INTO column_configs (column_id, agent_type, max_agents, on_finish_column_id, on_reject_column_id)
                 VALUES (?, ?, ?, ?, ?)`
            )
            .run(data.columnId, data.agentType, data.maxAgents ?? 1, data.onFinishColumnId ?? null, data.onRejectColumnId ?? null);
        return this.findByColumnId(data.columnId)!;
    },

    delete(columnId: string): void {
        getDb()
            .prepare('DELETE FROM column_configs WHERE column_id = ?')
            .run(columnId);
    },
};
