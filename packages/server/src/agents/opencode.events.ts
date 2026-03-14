import { ticketRepository } from '../repositories/ticket.repository.js';
import { commentRepository } from '../repositories/comment.repository.js';
import { agentQueue } from './agent-queue.js';
import type { Ticket, ColumnConfig } from '../types.js';
import { runCmd, normalizePathForOS, getGhToken } from '../utils/os.js';
import { createBoardScopedClient } from '../utils/opencode.js';
import fs from 'fs';

export async function setupOpencodeEventListener(
    events: any,
    _unused: any, // kept for signature compatibility if called elsewhere
    sessionID: string,
    ticket: Ticket,
    agentUrl: string,
    config: ColumnConfig,
    activeSessions: Record<string, string>,
    worktreePath: string,
    originalWorkspacePath: string,
    branchName: string,
    agentType: 'opencode' | 'code_review' = 'opencode'
) {
    const opencodeClient = createBoardScopedClient(originalWorkspacePath);
    const processedMessages = new Set<string>();
    const activeParts = new Map<string, { commentId: string, fullText: string }>();
    let rawSessionCost = 0;
    
    let sessionCommentId: string | null = null;
    let sessionCommentContent = "";

    function updateSessionComment(content: string, type: 'status' | 'message' | 'pr' = 'message', append = true) {
        let prefix = "";
        if (type === 'status') prefix = "\n---\n";
        if (type === 'pr') prefix = "\n---\n";

        if (append) {
            sessionCommentContent += (sessionCommentContent ? prefix : "") + content;
        } else {
            sessionCommentContent = content;
        }

        if (sessionCommentId) {
            commentRepository.update(sessionCommentId, sessionCommentContent);
        } else {
            const comment = commentRepository.create({
                ticketId: ticket.id,
                author: 'opencode', // Fixed author for session log
                content: sessionCommentContent
            });
            sessionCommentId = comment.id;
        }
    }

    try {
        for await (const event of events.stream) {
            // FILTER for events belonging solely to THIS session
            const eventSessionId = (event.properties as any)?.sessionID || (event.properties as any)?.info?.sessionID || (event.properties as any)?.part?.sessionID;
            if (eventSessionId && eventSessionId !== sessionID) continue;

            // Handle Blocking Permissions
            if (event.type === 'permission.asked') {
                console.log(`[opencode-agent] Permission requested for ticket ${ticket.id}. Waiting for UI approval.`);

                updateSessionComment(`⚠️ **Permission Required**\n\nThe agent needs your permission to continue. Please open the [Agent UI](${agentUrl}) to approve or deny the request.`, 'status');

                ticketRepository.updateAgentSession(ticket.id, {
                    column_id: ticket.column_id,
                    agent_type: agentType,
                    status: 'needs_approval',
                    port: 4096,
                    url: agentUrl
                });
            }

            // Resume processing when permission is explicitly granted/answered
            if (event.type === 'permission.replied') {
                console.log(`[opencode-agent] Permission answered for ticket ${ticket.id}. Resuming processing.`);
                updateSessionComment(`✅ **Permission Handled**`, 'status');
                ticketRepository.updateAgentSession(ticket.id, {
                    column_id: ticket.column_id,
                    agent_type: agentType,
                    status: 'processing',
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
                        updateSessionComment(`⚠️ **API Retry Attempt ${status.attempt}**\n\n${status.message}`, 'status');
                    }
                }
            }

            // Handle Fatal Session Errors
            if (event.type === 'session.error') {
                const err = event.properties.error as any;
                if (err) {
                    updateSessionComment(`❌ **Fatal Error: ${err.name}**\n\n${err.data?.message || JSON.stringify(err.data)}`, 'status');

                    // Agent failed, mark ticket as blocked/failed
                    ticketRepository.updateAgentSession(ticket.id, {
                        column_id: ticket.column_id,
                        agent_type: agentType,
                        status: 'blocked',
                        port: 4096,
                        url: agentUrl,
                        error_message: err.data?.message || err.name
                    });
                }
            }
                   // Handle Text Messages (Wait for assistant message to complete)
            if (event.type === 'message.updated') {
                const info = event.properties.info as any;
                if (info.cost) {
                    rawSessionCost += info.cost;
                }
                if (info.role === 'assistant' && info.time?.completed && !processedMessages.has(info.id)) {
                    processedMessages.add(info.id);

                    try {
                        const messagesRes = await opencodeClient.session.messages({ path: { id: sessionID } });
                        if (messagesRes.data) {
                            const targetMsg = (messagesRes.data as any[]).find((m: any) => m.info.id === info.id);
                            if (targetMsg && targetMsg.parts) {
                                let combinedText = '';
                                for (const part of targetMsg.parts) {
                                    if (part.type === 'text' && part.text?.trim()) {
                                        combinedText += (combinedText ? '\n\n' : '') + part.text.trim();
                                    }
                                }

                                if (combinedText) {
                                    // With session consolidation, we might just want to refresh or ensure it's there.
                                    // For now, let's keep it simple: the deltas handle the live updates, 
                                    // and message.updated ensures the final state is correct if deltas were missed.
                                    // We don't want to double append. 
                                    // Since we are using a single sessionCommentContent, we'll just let deltas do the work.
                                }
                            }
                        }
                    } catch (fetchErr) {
                        console.error(`[opencode-agent] Failed to fetch parts for message ${info.id}`, fetchErr);
                    }
                }
            }

            // Handle Tool Completions and Reasoning Real-Time
            // (WE NOW IGNORE THESE AS PER USER REQUEST TO ONLY SHOW IMPORTANT COMMENTS)
            if (event.type === 'message.part.updated') {
                const part = event.properties.part as any;
                if (part.type === 'step-finish' && part.cost) {
                    rawSessionCost += part.cost;
                }
            }

            // Handle Session Idle (Task Completed)
            if (event.type === 'session.idle') {
                console.log(`[opencode-agent] Agent task completed (idle) for ticket ${ticket.id}.`);

                // Check if the current session failed with a fatal error previously
                const currentTicket = ticketRepository.findById(ticket.id);
                const sessionsForColumn = currentTicket?.agent_sessions?.filter((s: any) => s.column_id === ticket.column_id) || [];
                const latestSession = sessionsForColumn[sessionsForColumn.length - 1];
                const hasError = latestSession?.status === 'blocked';

                if (!hasError) {
                    if (agentType === 'code_review') {
                        // Mark the ticket as done now that the agent session finished processing
                        ticketRepository.updateAgentSession(ticket.id, {
                            column_id: ticket.column_id,
                            agent_type: agentType,
                            status: 'done',
                            port: 4096,
                            url: agentUrl,
                            total_cost: rawSessionCost > 0 ? Number(rawSessionCost.toFixed(4)) : undefined
                        });

                        try {
                            // Find out if the PR was approved or changes requested
                            const latestTicket = ticketRepository.findById(ticket.id) || ticket;
                            const prUrlSession = [...(latestTicket.agent_sessions || [])].reverse().find(s => s.pr_url);
                            const prUrl = prUrlSession?.pr_url;
                            if (prUrl) {
                                const { stdout: prStatus } = await runCmd('gh', ['pr', 'view', prUrl, '--json', 'comments'], worktreePath, 'opencode-events');
                                const comments = JSON.parse(prStatus).comments;

                                // Find the latest comment that contains a decision
                                let reviewDecision = 'NONE';

                                // 1. Check GitHub PR comments First
                                if (comments && comments.length > 0) {
                                    for (const comment of [...comments].reverse()) {
                                        const bodyLower = comment.body.toLowerCase();
                                        if (bodyLower.includes('[approved]') || bodyLower.includes('approve the pr') || bodyLower.includes('lgtm') || bodyLower.includes('approved')) {
                                            reviewDecision = 'APPROVED';
                                            break;
                                        }
                                        if (bodyLower.includes('[changes_requested]') || bodyLower.includes('request changes') || bodyLower.includes('changes requested') || bodyLower.includes('changes are needed')) {
                                            reviewDecision = 'CHANGES_REQUESTED';
                                            break;
                                        }
                                    }
                                }

                                // 2. Fallback to Local Chat Logs
                                if (reviewDecision === 'NONE') {
                                    const localDbComments = commentRepository.findByTicketId(ticket.id);
                                    if (localDbComments && localDbComments.length > 0) {
                                        for (const dbC of [...localDbComments].reverse()) {
                                            const bodyLower = dbC.content.toLowerCase();
                                            if (bodyLower.includes('[approved]') || bodyLower.includes('approve the pr') || bodyLower.includes('lgtm') || bodyLower.includes('approved')) {
                                                reviewDecision = 'APPROVED';
                                                break;
                                            }
                                            if (bodyLower.includes('[changes_requested]') || bodyLower.includes('request changes') || bodyLower.includes('changes requested') || bodyLower.includes('changes are needed')) {
                                                reviewDecision = 'CHANGES_REQUESTED';
                                                break;
                                            }
                                        }
                                    }
                                }

                                console.log(`[codereview-agent] PR ${prUrl} review decision parsed from comments: ${reviewDecision}`);

                                if (reviewDecision === 'APPROVED') {
                                    updateSessionComment(`✅ **Code Review Approved!**\n\nThe agent approved the PR.`, 'status');

                                    // Move ticket to the configured destination column (if set)
                                    if (config.on_finish_column_id) {
                                        console.log(`[codereview-agent] Moving ticket ${ticket.id} forward to column ${config.on_finish_column_id}`);
                                        const moved = ticketRepository.move(ticket.id, config.on_finish_column_id, 0);
                                        if (moved) {
                                            // Trigger via the queue so concurrency/priority rules are respected
                                            agentQueue.evaluateColumnQueue(config.on_finish_column_id);
                                        }
                                    }
                                } else if (reviewDecision === 'CHANGES_REQUESTED') {
                                    updateSessionComment(`⚠️ **Changes Requested**\n\nThe agent has requested changes on the PR. Sending ticket back for revision.`, 'status');

                                    if (config.on_reject_column_id) {
                                        console.log(`[codereview-agent] Moving ticket ${ticket.id} back to configured reject column ${config.on_reject_column_id}`);
                                        const moved = ticketRepository.move(ticket.id, config.on_reject_column_id, 0);
                                        if (moved) {
                                            // Use force=true so the dev agent will re-run even though it previously finished 'done'
                                            agentQueue.enqueue(moved.id, true);
                                        }
                                    } else {
                                        console.warn(`[codereview-agent] Ticket ${ticket.id} rejected, but no 'on_reject_column_id' is configured!`);
                                    }
                                } else {
                                    updateSessionComment(`ℹ️ **Code Review Finished**\n\nThe review was completed, but no explicit approval or changes were requested.`, 'status');
                                }
                            }
                        } catch (err: any) {
                            console.error(`[codereview-agent] Error handling post-review logic`, err);
                        }
                    } else if (agentType === 'opencode') {
                        // Commit, push, and create PR before moving ticket
                        try {
                            console.log(`[opencode-agent] Checking for changes in worktree ${worktreePath}`);
                            const { stdout: statusOut } = await runCmd('git', ['status', '--porcelain'], worktreePath, 'opencode-events');

                            if (statusOut.trim()) {
                                console.log(`[opencode-agent] Changes found for ticket ${ticket.id}. Committing and pushing.`);
                                await runCmd('git', ['add', '.'], worktreePath, 'opencode-events');
                                await runCmd('git', ['commit', '-m', `"${ticket.title.replace(/"/g, '\\"')}"`], worktreePath, 'opencode-events');

                                // Inject GH_TOKEN into remote URL for git push authentication
                                const token = await getGhToken(worktreePath);
                                if (token) {
                                    try {
                                        const { stdout: remoteUrlOut } = await runCmd('git', ['config', '--get', 'remote.origin.url'], worktreePath);
                                        const remoteUrl = remoteUrlOut.trim();
                                        if (remoteUrl.startsWith('https://github.com/')) {
                                            const authedUrl = remoteUrl.replace('https://github.com/', `https://x-access-token:${token}@github.com/`);
                                            await runCmd('git', ['remote', 'set-url', 'origin', authedUrl], worktreePath, 'opencode-events');
                                        }
                                    } catch (urlErr) {
                                        console.warn(`[opencode-agent] Could not set authenticated remote URL:`, urlErr);
                                    }
                                }

                                await runCmd('git', ['push', '-u', 'origin', branchName], worktreePath, 'opencode-events');

                                // Check if a PR already exists for this ticket (fetch fresh from DB)
                                const freshTicket = ticketRepository.findById(ticket.id) || ticket;
                                const existingPrUrlSession = [...(freshTicket.agent_sessions || [])].reverse().find(s => s.pr_url);
                                let prUrl = existingPrUrlSession?.pr_url;

                                if (prUrl) {
                                    updateSessionComment(`🚀 **Pull Request Updated**\n\nThe agent has updated the existing PR:\n${prUrl}${rawSessionCost > 0 ? `\n\n**Total Cost:** $${rawSessionCost.toFixed(4)}` : ''}`, 'pr');
                                } else {
                                    const { stdout: prOut } = await runCmd('gh', ['pr', 'create', '--title', `"${ticket.title.replace(/"/g, '\\"')}"`, '--body', `"Automated PR from OpenCode Agent for ticket #${ticket.id}"`], worktreePath, 'opencode-events');
                                    prUrl = prOut.trim();
                                    updateSessionComment(`🚀 **Pull Request Created**\n\nThe agent has proposed the following changes in a PR. Check it out:\n${prUrl}${rawSessionCost > 0 ? `\n\n**Total Cost:** $${rawSessionCost.toFixed(4)}` : ''}`, 'pr');
                                }

                                // Add PR URL to the active agent session and mark as done
                                ticketRepository.updateAgentSession(ticket.id, {
                                    column_id: ticket.column_id,
                                    agent_type: 'opencode',
                                    status: 'done',
                                    port: 4096,
                                    url: agentUrl,
                                    pr_url: prUrl,
                                    total_cost: rawSessionCost > 0 ? Number(rawSessionCost.toFixed(4)) : undefined
                                });

                                // Move ticket to the configured destination column (if set)
                                if (config.on_finish_column_id) {
                                    console.log(`[opencode-agent] Moving ticket ${ticket.id} to column ${config.on_finish_column_id}`);
                                    const moved = ticketRepository.move(ticket.id, config.on_finish_column_id, 0);
                                    if (moved) {
                                        // Trigger via the queue so concurrency/priority rules are respected
                                        agentQueue.evaluateColumnQueue(config.on_finish_column_id);
                                    }
                                }
                            } else {
                                console.log(`[opencode-agent] No changes to push for ticket ${ticket.id}.`);
                                updateSessionComment(`ℹ️ **Task Completed (No Changes)**\n\nThe agent finished the task but did not make any code changes.${rawSessionCost > 0 ? `\n\n**Total Cost:** $${rawSessionCost.toFixed(4)}` : ''}`, 'status');

                                // Mark as done even if no changes
                                ticketRepository.updateAgentSession(ticket.id, {
                                    column_id: ticket.column_id,
                                    agent_type: 'opencode',
                                    status: 'done',
                                    port: 4096,
                                    url: agentUrl,
                                    total_cost: rawSessionCost > 0 ? Number(rawSessionCost.toFixed(4)) : undefined
                                });

                                // Still move to the next column if no changes (assumed done)
                                if (config.on_finish_column_id) {
                                    console.log(`[opencode-agent] Moving ticket ${ticket.id} to column ${config.on_finish_column_id}`);
                                    const moved = ticketRepository.move(ticket.id, config.on_finish_column_id, 0);
                                    if (moved) {
                                        agentQueue.evaluateColumnQueue(config.on_finish_column_id);
                                    }
                                }
                            }
                        } catch (error: any) {
                            console.error(`[opencode-agent] Failed to create PR for ticket ${ticket.id}`, error);
                            updateSessionComment(`❌ **Failed to Create PR**\n\nThe agent finished the task, but an error occurred while pushing changes or creating the PR:\n\`\`\`\n${error.message}\n\`\`\`\n\nYou can review the changes locally at: ${worktreePath}`, 'status');

                            // Mark as blocked due to PR failure
                            ticketRepository.updateAgentSession(ticket.id, {
                                column_id: ticket.column_id,
                                agent_type: 'opencode',
                                status: 'blocked',
                                port: 4096,
                                url: agentUrl,
                                worktree_path: worktreePath,
                                error_message: `PR creation failed: ${error.message}`
                            });
                        }
                    } // End of agentType === 'opencode' block
                }

                // Wait! Since this ticket finished processing, we should re-evaluate the CURRENT column
                // so the next pending ticket can be picked up by an agent.
                agentQueue.evaluateColumnQueue(ticket.column_id);

                // Clean up the server instance tracking after a brief delay
                setTimeout(() => {
                    console.log(`[opencode-agent] Cleaning up tracking for ${ticket.id}`);
                    delete activeSessions[ticket.id];
                }, 60000); // 1 minute cleanup
            }

            // ── Live Text Streaming via Deltas ──
            if ((event as any).type === 'message.part.delta') {
                const delta = (event as any).properties.delta;
                const messageID = (event.properties as any).messageID;

                if (delta && messageID) {
                    updateSessionComment(delta, 'message', true);
                }
            }
        }
    } catch (err) {
        console.error(`[opencode-agent] Event stream error for ticket ${ticket.id}:`, err);
    }
}
