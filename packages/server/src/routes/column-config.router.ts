import { Router, Request, Response } from 'express';
import { columnConfigRepository } from '../repositories/column-config.repository.js';
import { sseManager } from '../sse.js';
import type { AgentType } from '../types.js';

const router = Router({ mergeParams: true });

// GET /api/boards/:boardId/columns/configs
// Fetches all configs for all columns in this board
router.get('/configs', (req: Request, res: Response) => {
    const configs = columnConfigRepository.findByBoardId(req.params.boardId);
    res.json(configs);
});

// GET /api/boards/:boardId/columns/:id/config
router.get('/:id/config', (req: Request, res: Response) => {
    const config = columnConfigRepository.findByColumnId(req.params.id);
    if (!config) {
        res.json({ column_id: req.params.id, agent_type: 'none', on_finish_column_id: null });
        return;
    }
    res.json(config);
});

// PUT /api/boards/:boardId/columns/:id/config
router.put('/:id/config', (req: Request, res: Response) => {
    const { agentType, maxAgents, onFinishColumnId, onRejectColumnId } = req.body as {
        agentType: AgentType;
        maxAgents?: number;
        onFinishColumnId?: string | null;
        onRejectColumnId?: string | null;
    };
    if (!agentType) {
        res.status(400).json({ error: 'agentType is required' });
        return;
    }
    const config = columnConfigRepository.upsert({
        columnId: req.params.id,
        agentType,
        maxAgents,
        onFinishColumnId,
        onRejectColumnId,
    });
    sseManager.emit(req.params.boardId, 'column:config:updated', config);
    res.json(config);
});

// DELETE /api/boards/:boardId/columns/:id/config
router.delete('/:id/config', (req: Request, res: Response) => {
    columnConfigRepository.delete(req.params.id);
    sseManager.emit(req.params.boardId, 'column:config:deleted', { columnId: req.params.id });
    res.status(204).end();
});

export { router as columnConfigRouter };
