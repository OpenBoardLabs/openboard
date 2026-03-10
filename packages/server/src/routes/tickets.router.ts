import { Router, Request, Response } from 'express';
import { ticketRepository } from '../repositories/ticket.repository.js';
import { commentRepository } from '../repositories/comment.repository.js';
import { sseManager } from '../sse.js';
import { triggerAgent } from '../agents/agent-runner.js';
import { agentQueue } from '../agents/agent-queue.js';
import type { Priority } from '../types.js';

const router = Router({ mergeParams: true });

// GET /api/boards/:boardId/tickets
router.get('/', (req: Request, res: Response) => {
    res.json(ticketRepository.findByBoardId(req.params.boardId));
});

// POST /api/boards/:boardId/tickets
router.post('/', (req: Request, res: Response) => {
    const { title, description, priority, columnId } = req.body as {
        title: string;
        description?: string;
        priority?: Priority;
        columnId: string;
    };
    if (!title?.trim() || !columnId) {
        res.status(400).json({ error: 'title and columnId are required' });
        return;
    }
    const ticket = ticketRepository.create({
        boardId: req.params.boardId,
        columnId,
        title: title.trim(),
        description,
        priority,
    });
    triggerAgent(ticket);

    // Return latest DB state (might have agent_status: 'processing')
    const latest = ticketRepository.findById(ticket.id) || ticket;
    res.status(201).json(latest);
});

// PATCH /api/boards/:boardId/tickets/:id
router.patch('/:id', (req: Request, res: Response) => {
    const { title, description, priority } = req.body as Partial<{
        title: string;
        description: string;
        priority: Priority;
    }>;
    const ticket = ticketRepository.update(req.params.id, { title, description, priority });
    if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
    }
    res.json(ticket);
});

// PUT /api/boards/:boardId/tickets/:id/move
router.put('/:id/move', (req: Request, res: Response) => {
    const { toColumnId, position } = req.body as { toColumnId: string; position: number };
    const ticket = ticketRepository.move(req.params.id, toColumnId, position);
    if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
    }
    triggerAgent(ticket);
    res.json(ticket);
});

// POST /api/boards/:boardId/tickets/:id/retry
router.post('/:id/retry', (req: Request, res: Response) => {
    const ticket = ticketRepository.findById(req.params.id);
    if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
    }
    // Only retry if it failed or hasn't started
    // We pass force=true so that if it is in 'blocked' state, it gets cleared.
    triggerAgent(ticket, true);
    res.status(202).json({ status: 'retrying' });
});

// DELETE /api/boards/:boardId/tickets/:id
router.delete('/:id', (req: Request, res: Response) => {
    ticketRepository.delete(req.params.id);
    agentQueue.ping();
    res.status(204).end();
});

// GET /api/boards/:boardId/tickets/:id/comments
router.get('/:id/comments', (req: Request, res: Response) => {
    const comments = commentRepository.findByTicketId(req.params.id);
    res.json(comments);
});

// POST /api/boards/:boardId/tickets/:id/comments
router.post('/:id/comments', (req: Request, res: Response) => {
    const { content, author } = req.body as { content: string; author?: string };
    if (!content?.trim()) {
        res.status(400).json({ error: 'content is required' });
        return;
    }
    const comment = commentRepository.create({
        ticketId: req.params.id,
        author,
        content: content.trim(),
    });
    res.status(201).json(comment);
});

export { router as ticketsRouter };
