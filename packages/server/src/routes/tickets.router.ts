import { Router, Request, Response } from 'express';
import { ticketRepository } from '../repositories/ticket.repository.js';
import { boardRepository } from '../repositories/board.repository.js';
import { commentRepository } from '../repositories/comment.repository.js';
import { sseManager } from '../sse.js';
import { triggerAgent } from '../agents/agent-runner.js';
import { agentQueue } from '../agents/agent-queue.js';
import { runCmd } from '../utils/os.js';
import path from 'path';
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

// POST /api/boards/:boardId/tickets/:id/merge
router.post('/:id/merge', async (req: Request, res: Response) => {
    const ticket = ticketRepository.findById(req.params.id);
    if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
    }

    const board = boardRepository.findById(req.params.boardId);
    if (!board || !board.path) {
        res.status(400).json({ error: 'Board path not found' });
        return;
    }

    // Find the latest session with a worktree path
    const worktreeSession = [...(ticket.agent_sessions ?? [])].reverse().find(s => s.worktree_path);
    if (!worktreeSession || !worktreeSession.worktree_path) {
        res.status(400).json({ error: 'No worktree found for this ticket' });
        return;
    }

    if (worktreeSession.merged) {
        res.status(400).json({ error: 'This branch is already merged' });
        return;
    }

    const branchName = path.basename(worktreeSession.worktree_path);

    try {
        console.log(`[merge] Merging branch ${branchName} into master in ${board.path}...`);
        
        // Ensure we are on master first? Or just merge into master.
        // Usually, the board path repo is on master.
        const { stdout, stderr } = await runCmd('git', ['merge', branchName], board.path, 'merge-action');
        
        // Update the session to mark as merged
        ticketRepository.updateAgentSession(ticket.id, {
            column_id: worktreeSession.column_id,
            agent_type: worktreeSession.agent_type,
            status: worktreeSession.status,
            merged: true
        });

        commentRepository.create({
            ticketId: ticket.id,
            author: 'system',
            content: `✅ **Successfully merged ${branchName} into master**\n\n\`\`\`\n${stdout}\n\`\`\``
        });

        res.json({ status: 'success', stdout, stderr });
    } catch (e: any) {
        console.error(`[merge] Failed to merge: ${e.message}`);
        
        commentRepository.create({
            ticketId: ticket.id,
            author: 'system',
            content: `❌ **Failed to merge ${branchName} into master**\n\nError: ${e.message}`
        });

        res.status(500).json({ error: e.message });
    }
});

// GET /api/boards/:boardId/tickets/:id/diff
router.get('/:id/diff', async (req: Request, res: Response) => {
    const ticket = ticketRepository.findById(req.params.id);
    if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
    }

    const board = boardRepository.findById(req.params.boardId);
    if (!board || !board.path) {
        res.status(400).json({ error: 'Board path not found' });
        return;
    }

    // Find the latest session with a worktree path
    const worktreeSession = [...(ticket.agent_sessions ?? [])].reverse().find(s => s.worktree_path);
    if (!worktreeSession || !worktreeSession.worktree_path) {
        res.status(400).json({ error: 'No worktree found for this ticket' });
        return;
    }

    const branchName = path.basename(worktreeSession.worktree_path);

    try {
        console.log(`[diff] Fetching diff for branch ${branchName} in ${board.path}...`);
        
        // Run git diff master...branch
        // This shows changes in branch since it diverged from master
        const { stdout } = await runCmd('git', ['diff', 'master...' + branchName], board.path, 'diff-action');
        
        res.json({ diff: stdout });
    } catch (e: any) {
        console.error(`[diff] Failed to get diff: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
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
