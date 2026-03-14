import express from 'express';
import cors from 'cors';
import { initDb } from './db/database.js';
import { boardsRouter } from './routes/boards.router.js';
import { columnsRouter } from './routes/columns.router.js';
import { ticketsRouter } from './routes/tickets.router.js';
import { columnConfigRouter } from './routes/column-config.router.js';
import { systemRouter } from './routes/system.router.js';
import { sseManager } from './sse.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ?? 4199;

async function start() {
    await initDb();
    console.log('[openboard] Database ready');

    const app = express();
    app.use(cors({ origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(',') : ['http://localhost:5173', 'http://localhost:4173'] }));
    app.use(express.json());

    // SSE subscription endpoint
    // GET /api/events?boardId=<id>
    // Clients subscribe here; the server pushes events whenever data changes.
    app.get('/api/events', (req, res) => {
        const boardId = (req.query.boardId as string) || '*';

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if present
        res.flushHeaders();

        // Register this connection
        sseManager.subscribe(boardId, res);

        // Send a connected confirmation event
        res.write(`event: connected\ndata: ${JSON.stringify({ boardId })}\n\n`);

        // Heartbeat every 25 s to keep the connection alive through proxies/firewalls
        const heartbeat = setInterval(() => {
            try {
                res.write(': heartbeat\n\n');
            } catch {
                clearInterval(heartbeat);
            }
        }, 25_000);

        req.on('close', () => {
            clearInterval(heartbeat);
            sseManager.unsubscribe(boardId, res);
        });
    });

    app.use('/api/boards', boardsRouter);
    app.use('/api/boards/:boardId/columns', columnsRouter);
    app.use('/api/boards/:boardId/tickets', ticketsRouter);
    app.use('/api/boards/:boardId/columns', columnConfigRouter);
    app.use('/api/system', systemRouter);
    app.get('/api/health', (_req, res) => res.json({ status: 'ok', port: actualPort }));

    // Serve the built client
    const clientExtPath = path.join(__dirname, '../../client/dist');
    app.use(express.static(clientExtPath));

    app.get('*', (req, res) => {
        res.sendFile(path.join(clientExtPath, 'index.html'));
    });

    const server = app.listen(PORT);
    
    let actualPort: number = parseInt(String(PORT));

    server.on('listening', () => {
        const address = server.address();
        actualPort = typeof address === 'string' ? parseInt(address) : (address?.port ?? parseInt(String(PORT)));
        process.env.OPENBOARD_PORT = String(actualPort);
        console.log(`[openboard] Server running at http://localhost:${actualPort}`);
    });

    server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`[openboard] Port ${PORT} is in use, trying a random available port...`);
            server.close();
            server.listen(0);
        } else {
            console.error('[openboard] Server error:', err);
        }
    });
}

start().catch(err => {
    console.error('[openboard] Failed to start:', err);
    process.exit(1);
});
