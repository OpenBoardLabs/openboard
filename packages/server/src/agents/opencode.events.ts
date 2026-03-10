import { ticketRepository } from '../repositories/ticket.repository.js';
import { commentRepository } from '../repositories/comment.repository.js';
import type { Ticket, ColumnConfig } from '../types.js';

export async function setupOpencodeEventListener(
    events: any,
    opencodeClient: any,
    sessionID: string,
    ticket: Ticket,
    agentUrl: string,
    config: ColumnConfig,
    activeSessions: Record<string, string>
) {
    const processedMessages = new Set<string>();
    const processedTools = new Set<string>();
    const activeParts = new Map<string, { commentId: string, fullText: string }>();

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
                            const targetMsg = (messagesRes.data as any[]).find((m: any) => m.info.id === info.id);
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

            // Handle Session Idle (Task Completed)
            if (event.type === 'session.idle') {
                console.log(`[opencode-agent] Agent task completed (idle) for ticket ${ticket.id}.`);

                // Check if the session failed with a fatal error previously
                const currentTicket = ticketRepository.findById(ticket.id);
                const hasError = currentTicket?.agent_sessions?.some((s: any) => s.column_id === ticket.column_id && s.status === 'blocked');

                if (!hasError) {
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
                            import('./agent-runner.js').then(({ triggerAgent }) => {
                                triggerAgent(moved);
                            }).catch(err => console.error("Failed to trigger agent runner", err));
                        }
                    }
                }

                // Clean up the server instance tracking after a brief delay
                setTimeout(() => {
                    console.log(`[opencode-agent] Cleaning up tracking for ${ticket.id}`);
                    delete activeSessions[ticket.id];
                }, 60000); // 1 minute cleanup
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
}
