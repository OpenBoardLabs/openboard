import { Router, Request, Response } from 'express';
import { columnRepository } from '../repositories/column.repository.js';
import { sseManager } from '../sse.js';

const router = Router({ mergeParams: true });

// GET /api/boards/:boardId/columns
router.get('/', (req: Request, res: Response) => {
    res.json(columnRepository.findByBoardId(req.params.boardId));
});

// POST /api/boards/:boardId/columns
router.post('/', (req: Request, res: Response) => {
    const { name } = req.body as { name: string };
    if (!name?.trim()) {
        res.status(400).json({ error: 'Name is required' });
        return;
    }
    const column = columnRepository.create(req.params.boardId, name.trim());
    sseManager.emit(req.params.boardId, 'column:created', column);
    res.status(201).json(column);
});

// PATCH /api/boards/:boardId/columns/:id
router.patch('/:id', (req: Request, res: Response) => {
    const { name } = req.body as { name: string };
    const column = columnRepository.update(req.params.id, name.trim());
    if (!column) {
        res.status(404).json({ error: 'Column not found' });
        return;
    }
    sseManager.emit(req.params.boardId, 'column:updated', column);
    res.json(column);
});

// PUT /api/boards/:boardId/columns/reorder
router.put('/reorder', (req: Request, res: Response) => {
    const { orderedIds } = req.body as { orderedIds: string[] };
    columnRepository.reorder(req.params.boardId, orderedIds);
    const columns = columnRepository.findByBoardId(req.params.boardId);
    sseManager.emit(req.params.boardId, 'columns:reordered', columns);
    res.status(204).end();
});

// DELETE /api/boards/:boardId/columns/:id
router.delete('/:id', (req: Request, res: Response) => {
    columnRepository.delete(req.params.id);
    sseManager.emit(req.params.boardId, 'column:deleted', { id: req.params.id });
    res.status(204).end();
});

export { router as columnsRouter };
