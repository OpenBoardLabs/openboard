import { Router, Request, Response } from 'express';
import { boardRepository } from '../repositories/board.repository.js';
import { sseManager } from '../sse.js';
import type { BoardWorkspace } from '../types.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
    res.json(boardRepository.findAll());
});

router.post('/', (req: Request, res: Response) => {
    const { name, path, workspaces } = req.body as { name: string, path?: string, workspaces: Omit<BoardWorkspace, 'id' | 'board_id'>[] };
    if (!name?.trim()) {
        res.status(400).json({ error: 'Name is required' });
        return;
    }
    const board = boardRepository.create(name.trim(), path, workspaces);
    sseManager.emitGlobal('board:created', board);
    res.status(201).json(board);
});

router.patch('/:id', (req: Request, res: Response) => {
    const { name, path, workspaces } = req.body as { name: string, path?: string, workspaces: Omit<BoardWorkspace, 'id' | 'board_id'>[] };
    const board = boardRepository.update(req.params.id, name?.trim(), path, workspaces);
    if (!board) {
        res.status(404).json({ error: 'Board not found' });
        return;
    }
    sseManager.emitGlobal('board:updated', board);
    res.json(board);
});

router.delete('/:id', (req: Request, res: Response) => {
    boardRepository.delete(req.params.id);
    sseManager.emitGlobal('board:deleted', { id: req.params.id });
    res.status(204).end();
});

export { router as boardsRouter };
