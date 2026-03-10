import { createOpencodeClient } from '@opencode-ai/sdk';
import type { Agent } from './agent.interface.js';
import type { Ticket, ColumnConfig } from '../types.js';
import { ticketRepository } from '../repositories/ticket.repository.js';
import { boardRepository } from '../repositories/board.repository.js';
import { commentRepository } from '../repositories/comment.repository.js';
import { setupOpencodeEventListener } from './opencode.events.js';

// Central OpenCode client connecting to the user's running OpenCode server
const opencodeClient = createOpencodeClient({ baseUrl: 'http://127.0.0.1:4096' });

// Track active session IDs by ticket ID to prevent/cancel overlaps
const activeSessions: Record<string, string> = {};

export class OpencodeAgent implements Agent {
    async run(ticket: Ticket, config: ColumnConfig): Promise<void> {
        console.log(`[opencode-agent] Starting session for ticket ${ticket.id}...`);

        // Provide immediate visual feedback on the Frontend
        ticketRepository.updateAgentSession(ticket.id, {
            column_id: ticket.column_id,
            agent_type: 'opencode',
            status: 'processing',
            port: 4096
        });

        // Prevent duplicate runs blocking new requests: replace the old session.
        if (activeSessions[ticket.id]) {
            console.log(`[opencode-agent] Session already running for ticket ${ticket.id}. Aborting old session to start a fresh one.`);
            try {
                // Ignore typescript error if abort typing differs slightly in SDK version
                await (opencodeClient.session as any).abort({ path: { id: activeSessions[ticket.id] } });
            } catch (e) {
                console.error(`[opencode-agent] Error aborting previous session:`, e);
            }
            delete activeSessions[ticket.id];
        }

        // 1. Find Worktree (For this MVP, we use the first folder workspace of the board)
        const board = boardRepository.findById(ticket.board_id);
        if (!board) throw new Error(`Board not found: ${ticket.board_id}`);

        const folderWorkspace = board.workspaces.find(ws => ws.type === 'folder');
        if (!folderWorkspace) {
            console.error(`[opencode-agent] No usable folder workspace found for board ${board.id}`);
            return;
        }
        const worktreePath = folderWorkspace.path;

        // 2. Initialize Task
        try {
            // Create session
            const session = await opencodeClient.session.create({
                body: {
                    title: `Session for Ticket: ${ticket.title}`,
                },
                query: {
                    directory: worktreePath
                }
            });

            if (!session.data) throw new Error("Failed to create OpenCode session");

            const sessionID = session.data.id;
            activeSessions[ticket.id] = sessionID;

            // Compute exact OpenCode Tracking URL
            const encodedPath = Buffer.from(worktreePath).toString('base64url');
            const agentUrl = `http://127.0.0.1:4096/${encodedPath}/session/${sessionID}`;

            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'opencode',
                status: 'processing',
                port: 4096,
                url: agentUrl
            });

            // --- Background Event Stream Listener ---
            const events = await opencodeClient.event.subscribe();

            // Start the event listener in the background without awaiting it
            setupOpencodeEventListener(
                events,
                opencodeClient,
                sessionID,
                ticket,
                agentUrl,
                config,
                activeSessions
            );
            // ------------------------------------------

            // Send first message asynchronously (doesn't wait for completion)
            const promptRes = await opencodeClient.session.promptAsync({
                path: { id: sessionID },
                body: {
                    parts: [{
                        type: "text",
                        text: `# TASK: ${ticket.title}\n\n## Description\n${ticket.description}\n\n## Instructions\n1. The current working directory you should focus on is ${worktreePath}.\n`
                    }]
                }
            });

            if (promptRes.error) {
                throw new Error(`OpenCode session error: ${JSON.stringify(promptRes.error)}`);
            }

            console.log(`[opencode-agent] Agent task dispatched for ticket ${ticket.id}. Waiting for completion in background.`);

        } catch (e: any) {
            console.error(`[opencode-agent] Failed to initialize task over SDK: ${e.message}`);
            delete activeSessions[ticket.id];

            // Mark the ticket as blocked due to error
            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'opencode',
                status: 'blocked',
                url: activeSessions[ticket.id] ? `http://127.0.0.1:4096/${Buffer.from(worktreePath).toString('base64url')}/session/${activeSessions[ticket.id]}` : undefined,
                error_message: e.message
            });

            // Add a comment to explicitly tell the user what went wrong
            commentRepository.create({
                ticketId: ticket.id,
                author: 'System',
                content: `❌ **Agent Execution Failed**\n\nThe OpenCode agent failed to process this ticket.\nError: ${e.message}`
            });
        }
    }
}
