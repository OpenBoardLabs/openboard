import { createOpencodeClient } from '@opencode-ai/sdk';
import type { Agent } from './agent.interface.js';
import type { Ticket, ColumnConfig } from '../types.js';
import { sseManager } from '../sse.js';
import { ticketRepository } from '../repositories/ticket.repository.js';
import { boardRepository } from '../repositories/board.repository.js';
import { commentRepository } from '../repositories/comment.repository.js';
import path from 'path';

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

            console.log(session);

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
            const processedMessages = new Set<string>();
            const processedTools = new Set<string>();
            const activeParts = new Map<string, { commentId: string, fullText: string }>();

            (async () => {
                try {
                    for await (const event of events.stream) {

                        // FILTER for events belonging solely to THIS session
                        const eventSessionId = (event.properties as any)?.sessionID || (event.properties as any)?.info?.sessionID || (event.properties as any)?.part?.sessionID;
                        if (eventSessionId && eventSessionId !== sessionID) continue;

                        // Handle Blocking Permissions
                        if (event.type === 'permission.updated') {
                            console.log(`[opencode-agent] Permission requested for ticket ${ticket.id}. Blocking UI.`);
                            ticketRepository.updateAgentSession(ticket.id, {
                                column_id: ticket.column_id,
                                agent_type: 'opencode',
                                status: 'blocked',
                                port: 4096,
                                url: agentUrl
                            });
                        }

                        // Handle API Quotas & Retries
                        if (event.type === 'session.status') {
                            const status = event.properties.status;
                            if (status.type === 'retry') {
                                // Let's only post the retry warning on the first few attempts so it doesn't spam infinitely
                                if (status.attempt <= 5) {
                                    commentRepository.create({
                                        ticketId: ticket.id,
                                        author: 'System',
                                        content: `⚠️ **API Retry Attempt ${status.attempt}**\n\n${status.message}`
                                    });
                                }
                            }
                        }

                        // Handle Fatal Session Errors
                        if (event.type === 'session.error') {
                            const err = event.properties.error as any;
                            if (err) {
                                commentRepository.create({
                                    ticketId: ticket.id,
                                    author: 'System',
                                    content: `❌ **Fatal Error: ${err.name}**\n\n${err.data?.message || JSON.stringify(err.data)}`
                                });

                                // Agent failed, mark ticket as blocked/failed
                                ticketRepository.updateAgentSession(ticket.id, {
                                    column_id: ticket.column_id,
                                    agent_type: 'opencode',
                                    status: 'blocked',
                                    port: 4096,
                                    url: agentUrl,
                                    error_message: err.data?.message || err.name
                                });
                            }
                        }

                        // Handle Text Messages (Wait for assistant message to complete)
                        if (event.type === 'message.updated') {
                            const info = event.properties.info;
                            if (info.role === 'assistant' && info.time?.completed && !processedMessages.has(info.id)) {
                                processedMessages.add(info.id);

                                try {
                                    const messagesRes = await opencodeClient.session.messages({ path: { id: sessionID } });
                                    if (messagesRes.data) {
                                        const targetMsg = (messagesRes.data as any[]).find(m => m.info.id === info.id);
                                        if (targetMsg && targetMsg.parts) {
                                            for (const part of targetMsg.parts) {
                                                if (part.type === 'text' && part.text?.trim()) {
                                                    commentRepository.create({
                                                        ticketId: ticket.id,
                                                        author: 'opencode',
                                                        content: part.text.trim()
                                                    });
                                                }
                                            }
                                        }
                                    }
                                } catch (fetchErr) {
                                    console.error(`[opencode-agent] Failed to fetch parts for message ${info.id}`, fetchErr);
                                }
                            }
                        }

                        // Handle Tool Completions and Reasoning Real-Time
                        if (event.type === 'message.part.updated') {
                            const part = event.properties.part;

                            // 1. Handle tool executions
                            if (part.type === 'tool' && part.state?.status === 'completed' && !processedTools.has(part.id)) {
                                processedTools.add(part.id);
                                let content = `Executed \`${part.tool}\``;
                                if (part.state.title) content += `\n*${part.state.title}*`;

                                commentRepository.create({
                                    ticketId: ticket.id,
                                    author: 'opencode',
                                    content: content
                                });
                            }

                            // 2. Handle final reasoning/thoughts block (if not caught by deltas)
                            if (part.type === 'reasoning' && !processedTools.has(part.id)) {
                                processedTools.add(part.id);

                                // If we already tracked this via deltas, don't recreate it
                                if (!activeParts.has(part.id) && part.text && part.text.trim()) {
                                    commentRepository.create({
                                        ticketId: ticket.id,
                                        author: 'opencode (thought)',
                                        content: part.text.trim()
                                    });
                                }
                            }
                        }

                        // ── Live Text Streaming via Deltas ──
                        if ((event as any).type === 'message.part.delta') {
                            const partID = (event as any).properties.partID;
                            const delta = (event as any).properties.delta;

                            if (delta) {
                                let tracking = activeParts.get(partID);
                                if (!tracking) {
                                    // create initial comment
                                    const comment = commentRepository.create({
                                        ticketId: ticket.id,
                                        author: 'opencode',
                                        content: delta
                                    });
                                    tracking = { commentId: comment.id, fullText: delta };
                                    activeParts.set(partID, tracking);
                                } else {
                                    // update existing comment
                                    tracking.fullText += delta;
                                    commentRepository.update(tracking.commentId, tracking.fullText);
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.error(`[opencode-agent] Event stream error for ticket ${ticket.id}:`, err);
                }
            })();
            // ------------------------------------------

            // Send first message
            const promptRes = await opencodeClient.session.prompt({
                path: { id: sessionID },
                body: {
                    parts: [{
                        type: "text",
                        text: `# TASK: ${ticket.title}\n\n## Description\n${ticket.description}\n\n## Instructions\n1. The current working directory you should focus on is ${worktreePath}.\n`
                    }]
                }
            });

            console.log(promptRes);

            if (promptRes.error) {
                throw new Error(`OpenCode session error: ${JSON.stringify(promptRes.error)}`);
            }
            if ((promptRes.data as any)?.info?.error) {
                const err = (promptRes.data as any).info.error;
                throw new Error(`${err.name || 'Error'}: ${err.data?.message || JSON.stringify(err.data)}`);
            }

            console.log(`[opencode-agent] Agent task dispatched and completed for ticket ${ticket.id}.`);

            // Mark the ticket as done now that the agent session finished processing
            ticketRepository.updateAgentSession(ticket.id, {
                column_id: ticket.column_id,
                agent_type: 'opencode',
                status: 'done',
                port: 4096,
                url: agentUrl
            });

            // Move ticket to the configured destination column (if set)
            if (config.on_finish_column_id) {
                console.log(`[opencode-agent] Moving ticket ${ticket.id} to column ${config.on_finish_column_id}`);
                const moved = ticketRepository.move(ticket.id, config.on_finish_column_id, 0);
                if (moved) {
                    const { triggerAgent } = await import('./agent-runner.js');
                    triggerAgent(moved);
                }
            }

            // Clean up the server instance tracking after a brief delay
            setTimeout(() => {
                console.log(`[opencode-agent] Cleaning up tracking for ${ticket.id}`);
                delete activeSessions[ticket.id];
            }, 60000); // 1 minute cleanup

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
