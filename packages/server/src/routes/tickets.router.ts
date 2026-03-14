import { Router, Request, Response } from 'express';
import { ticketRepository } from '../repositories/ticket.repository.js';
import { boardRepository } from '../repositories/board.repository.js';
import { commentRepository } from '../repositories/comment.repository.js';
import { sseManager } from '../sse.js';
import { triggerAgent } from '../agents/agent-runner.js';
import { agentQueue } from '../agents/agent-queue.js';
import { abortSession } from '../agents/abort-session.js';
import { runCmd } from '../utils/os.js';
import { findFreePort } from '../utils/port.js';
import { processRegistry } from '../utils/process-registry.js';
import { spawn } from 'child_process';
import net from 'net';
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
    
    const existingTicket = ticketRepository.findById(req.params.id);
    if (!existingTicket) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
    }
    
    const fromColumnId = existingTicket.column_id;
    
    const ticket = ticketRepository.move(req.params.id, toColumnId, position);
    if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
    }
    
    if (fromColumnId !== toColumnId) {
        abortSession(req.params.id, 'moved');
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
    // Requeue the ticket (e.g. after failure, abort, or to run again).
    // We pass force=true so that tickets in 'blocked' or 'aborted' state are requeued.
    triggerAgent(ticket, true);

    // Mark the last session for this column as 'queued' so the UI shows "Queued" instead of Error/Aborted
    // even when the queue doesn't dispatch immediately (e.g. max concurrency). When a slot frees up,
    // the queue will pick this ticket up and the agent will update the session to 'processing'.
    const lastForColumn = [...(ticket.agent_sessions ?? [])].filter(s => s.column_id === ticket.column_id).pop();
    if (lastForColumn && (lastForColumn.status === 'blocked' || lastForColumn.status === 'aborted')) {
        ticketRepository.updateAgentSession(ticket.id, {
            column_id: ticket.column_id,
            agent_type: lastForColumn.agent_type,
            status: 'queued',
        });
    }

    res.status(202).json({ status: 'retrying' });
});

// POST /api/boards/:boardId/tickets/:id/abort
router.post('/:id/abort', (req: Request, res: Response) => {
    const ticket = ticketRepository.findById(req.params.id);
    if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
    }

    abortSession(req.params.id, 'aborted');
    res.status(202).json({ status: 'aborting' });
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
// POST /api/boards/:boardId/tickets/:id/sessions/:index/resume
router.post('/:id/sessions/:index/resume', async (req: Request, res: Response) => {
    const { id, index } = req.params;
    const sessionIndex = parseInt(index, 10);
    const ticket = ticketRepository.findById(id);

    console.log(`[resume] Request for ticket ${id}, session index ${sessionIndex}`);

    if (!ticket || !ticket.agent_sessions[sessionIndex]) {
        console.error(`[resume] Session not found. Ticket sessions count: ${ticket?.agent_sessions?.length}`);
        res.status(404).json({ error: 'Session not found' });
        return;
    }

    const session = ticket.agent_sessions[sessionIndex];
    let port = session.port;

    if (!port && session.url) {
        try {
            const urlObj = new URL(session.url);
            port = parseInt(urlObj.port, 10) || 80;
            console.log(`[resume] Extracted port ${port} from URL: ${session.url}`);
        } catch (e: any) {
            console.error(`[resume] Invalid URL in session: ${session.url}`);
            console.error(`[resume] Error parsing URL: ${e?.message}`);
        }
    }

    if (!port) {
        console.error(`[resume] No port found for session at index ${sessionIndex}`);
        res.status(400).json({ error: 'No port associated with session' });
        return;
    }

    console.log(`[resume] Checking if port ${port} is open...`);
    // Check if port is open
    const isPortOpen = await new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(800);
        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.on('error', () => {
            socket.destroy();
            resolve(false);
        });
        socket.connect(Number(port), '127.0.0.1');
    });

    if (isPortOpen) {
        console.log(`[resume] Port ${port} is open, returning current URL.`);
        res.json({ url: session.url });
        return;
    }

    console.log(`[resume] Port ${port} is closed. Attempting to restart...`);

    const worktreePath = session.worktree_path || ticket.agent_sessions.find(s => s.worktree_path)?.worktree_path;

    // Port is closed, restart server
    if (!worktreePath) {
        console.error(`[resume] No worktree path for session index ${sessionIndex}. Cannot restart.`);
        res.status(400).json({ error: 'No worktree path found to restart session' });
        return;
    }

    try {
        const newPort = await findFreePort(4100); // Start from a slightly different range
        console.log(`[resume] Restarting opencode serve on port ${newPort} for ticket ${id}`);

        const serverProcess = spawn('opencode', ['serve', '--port', newPort.toString()], {
            cwd: session.worktree_path,
            env: { ...process.env, OPENCODE_PORT: newPort.toString() },
            stdio: 'ignore',
            detached: true
        });
        serverProcess.unref();
        processRegistry.register(id, serverProcess);

        // Wait a bit for server to start
        await new Promise(r => setTimeout(r, 3000));

        let newUrl = session.url;
        if (newUrl) {
            try {
                const urlObj = new URL(newUrl);
                urlObj.port = newPort.toString();
                newUrl = urlObj.toString();
            } catch (e) {
                // If URL parsing fails, just use port fallback
                newUrl = undefined;
            }
        }

        ticketRepository.updateAgentSessionByIndex(id, sessionIndex, {
            port: newPort,
            url: newUrl
        });

        console.log(`[resume] Successfully restarted and updated session with new URL: ${newUrl}`);
        res.json({ url: newUrl || `http://127.0.0.1:${newPort}` });
    } catch (err: any) {
        console.error(`[resume] Failed to restart session: ${err.message}`);
        res.status(500).json({ error: `Failed to restart session: ${err.message}` });
    }
});

export { router as ticketsRouter };
