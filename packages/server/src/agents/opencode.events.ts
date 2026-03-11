import { ticketRepository } from '../repositories/ticket.repository.js';
import { commentRepository } from '../repositories/comment.repository.js';
import { agentQueue } from './agent-queue.js';
import type { Ticket, ColumnConfig } from '../types.js';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Cache the gh token so we only fetch it once per server process
let cachedGhToken: string | null = null;
async function getGhToken(cwd: string): Promise<string | null> {
    if (cachedGhToken !== null) return cachedGhToken;
    try {
        const { stdout } = await execFileAsync('gh', ['auth', 'token'], { cwd, shell: true });
        cachedGhToken = stdout.trim() || null;
    } catch {
        cachedGhToken = null;
    }
    return cachedGhToken;
}

// Helper function to execute commands robustly on Windows.
// Automatically injects GH_TOKEN for any `gh` subcommand.
async function runCmd(cmd: string, args: string[], cwd: string): Promise<{ stdout: string, stderr: string }> {
    console.log(`[opencode-events] Running: ${cmd} ${args.join(' ')} in cwd: ${cwd}`);

    // Safety check for CWD to avoid obscure ENOENT shell errors
    if (!fs.existsSync(cwd)) {
        throw new Error(`Directory does not exist: ${cwd}`);
    }

    let extraEnv: Record<string, string> = {};
    if (cmd === 'gh') {
        const token = await getGhToken(cwd);
        if (token) extraEnv['GH_TOKEN'] = token;
    }
    const env = Object.keys(extraEnv).length > 0 ? { ...process.env, ...extraEnv } : undefined;

    try {
        return await execFileAsync(cmd, args, { cwd, shell: true, ...(env && { env }) });
    } catch (e: any) {
        if (e.code === 'ENOENT') {
            console.log(`[opencode-events] ENOENT with shell: true. Trying fallback exec...`);
            const envPrefix = extraEnv['GH_TOKEN'] ? `GH_TOKEN=${extraEnv['GH_TOKEN']} ` : '';
            return await execAsync(`${envPrefix}${cmd} ${args.join(' ')}`, { cwd });
        }
        throw e;
    }
}

export async function setupOpencodeEventListener(
    events: any,
    opencodeClient: any,
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
    const processedMessages = new Set<string>();
    const processedTools = new Set<string>();
    const activeParts = new Map<string, { commentId: string, fullText: string }>();
    let rawSessionCost = 0;

    try {
        for await (const event of events.stream) {
            // FILTER for events belonging solely to THIS session
            const eventSessionId = (event.properties as any)?.sessionID || (event.properties as any)?.info?.sessionID || (event.properties as any)?.part?.sessionID;
            if (eventSessionId && eventSessionId !== sessionID) continue;

            // Handle Blocking Permissions
            if (event.type === 'permission.asked') {
                console.log(`[opencode-agent] Permission requested for ticket ${ticket.id}. Waiting for UI approval.`);

                commentRepository.create({
                    ticketId: ticket.id,
                    author: 'System',
                    content: `⚠️ **Permission Required**\n\nThe agent needs your permission to continue. Please open the [Agent UI](${agentUrl}) to approve or deny the request.`
                });

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
                                    const existing = activeParts.get(info.id); // info.id is messageID
                                    if (existing) {
                                        commentRepository.update(existing.commentId, combinedText);
                                    } else {
                                        commentRepository.create({
                                            ticketId: ticket.id,
                                            author: 'opencode',
                                            content: combinedText
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
            // (WE NOW IGNORE THESE AS PER USER REQUEST TO ONLY SHOW IMPORTANT COMMENTS)
            if (event.type === 'message.part.updated') {
                const part = event.properties.part as any;
                if (part.type === 'step-finish' && part.cost) {
                    rawSessionCost += part.cost;
                }
            }
            /*
            if (event.type === 'message.part.updated') {
                const part = event.properties.part;
                // ... logic removed ...
            }
            */

            // Handle Session Idle (Task Completed)
            if (event.type === 'session.idle') {
                console.log(`[opencode-agent] Agent task completed (idle) for ticket ${ticket.id}.`);

                // Check if the current session failed with a fatal error previously
                const currentTicket = ticketRepository.findById(ticket.id);
                const sessionsForColumn = currentTicket?.agent_sessions?.filter((s: any) => s.column_id === ticket.column_id) || [];
                const latestSession = sessionsForColumn[sessionsForColumn.length - 1];
                const hasError = latestSession?.status === 'blocked';

                if (!hasError) {
                    // Mark the ticket as done now that the agent session finished processing
                    ticketRepository.updateAgentSession(ticket.id, {
                        column_id: ticket.column_id,
                        agent_type: agentType,
                        status: 'done',
                        port: 4096,
                        url: agentUrl,
                        total_cost: rawSessionCost > 0 ? Number(rawSessionCost.toFixed(4)) : undefined
                    });

                    if (agentType === 'code_review') {
                        try {
                            // Find out if the PR was approved or changes requested
                            const latestTicket = ticketRepository.findById(ticket.id) || ticket;
                            const prUrlSession = [...(latestTicket.agent_sessions || [])].reverse().find(s => s.pr_url);
                            const prUrl = prUrlSession?.pr_url;
                            if (prUrl) {
                                const { stdout: prStatus } = await runCmd('gh', ['pr', 'view', prUrl, '--json', 'comments'], worktreePath);
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
                                    commentRepository.create({
                                        ticketId: ticket.id,
                                        author: 'System',
                                        content: `✅ **Code Review Approved!**\n\nThe agent approved the PR.`
                                    });

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
                                    commentRepository.create({
                                        ticketId: ticket.id,
                                        author: 'System',
                                        content: `⚠️ **Changes Requested**\n\nThe agent has requested changes on the PR. Sending ticket back for revision.`
                                    });

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
                                    commentRepository.create({
                                        ticketId: ticket.id,
                                        author: 'System',
                                        content: `ℹ️ **Code Review Finished**\n\nThe review was completed, but no explicit approval or changes were requested.`
                                    });
                                }
                            }
                        } catch (err: any) {
                            console.error(`[codereview-agent] Error handling post-review logic`, err);
                        }
                    } else if (agentType === 'opencode') {
                        // Commit, push, and create PR before moving ticket
                        try {
                            console.log(`[opencode-agent] Checking for changes in worktree ${worktreePath}`);
                            const { stdout: statusOut } = await runCmd('git', ['status', '--porcelain'], worktreePath);

                            if (statusOut.trim()) {
                                console.log(`[opencode-agent] Changes found for ticket ${ticket.id}. Committing and pushing.`);
                                await runCmd('git', ['add', '.'], worktreePath);
                                await runCmd('git', ['commit', '-m', `"${ticket.title.replace(/"/g, '\\"')}"`], worktreePath);

                                // Inject GH_TOKEN into remote URL for git push authentication
                                const token = await getGhToken(worktreePath);
                                if (token) {
                                    try {
                                        const { stdout: remoteUrlOut } = await runCmd('git', ['config', '--get', 'remote.origin.url'], worktreePath);
                                        const remoteUrl = remoteUrlOut.trim();
                                        if (remoteUrl.startsWith('https://github.com/')) {
                                            const authedUrl = remoteUrl.replace('https://github.com/', `https://x-access-token:${token}@github.com/`);
                                            await runCmd('git', ['remote', 'set-url', 'origin', authedUrl], worktreePath);
                                        }
                                    } catch (urlErr) {
                                        console.warn(`[opencode-agent] Could not set authenticated remote URL:`, urlErr);
                                    }
                                }

                                await runCmd('git', ['push', '-u', 'origin', branchName], worktreePath);

                                // Check if a PR already exists for this ticket (fetch fresh from DB)
                                const freshTicket = ticketRepository.findById(ticket.id) || ticket;
                                const existingPrUrlSession = [...(freshTicket.agent_sessions || [])].reverse().find(s => s.pr_url);
                                let prUrl = existingPrUrlSession?.pr_url;

                                if (prUrl) {
                                    commentRepository.create({
                                        ticketId: ticket.id,
                                        author: 'System',
                                        content: `🚀 **Pull Request Updated**\n\nThe agent has updated the existing PR:\n${prUrl}${rawSessionCost > 0 ? `\n\n**Total Cost:** $${rawSessionCost.toFixed(4)}` : ''}`
                                    });
                                } else {
                                    const { stdout: prOut } = await runCmd('gh', ['pr', 'create', '--title', `"${ticket.title.replace(/"/g, '\\"')}"`, '--body', `"Automated PR from OpenCode Agent for ticket #${ticket.id}"`], worktreePath);
                                    prUrl = prOut.trim();
                                    commentRepository.create({
                                        ticketId: ticket.id,
                                        author: 'System',
                                        content: `🚀 **Pull Request Created**\n\nThe agent has proposed the following changes in a PR. Check it out:\n${prUrl}${rawSessionCost > 0 ? `\n\n**Total Cost:** $${rawSessionCost.toFixed(4)}` : ''}`
                                    });
                                }

                                // Add PR URL to the active agent session so the UI displays the code review button
                                ticketRepository.updateAgentSession(ticket.id, {
                                    column_id: ticket.column_id,
                                    agent_type: 'opencode',
                                    status: 'done',
                                    port: 4096,
                                    url: agentUrl,
                                    pr_url: prUrl,
                                    total_cost: rawSessionCost > 0 ? Number(rawSessionCost.toFixed(4)) : undefined
                                });
                            } else {
                                console.log(`[opencode-agent] No changes to push for ticket ${ticket.id}.`);
                                commentRepository.create({
                                    ticketId: ticket.id,
                                    author: 'System',
                                    content: `ℹ️ **Task Completed (No Changes)**\n\nThe agent finished the task but did not make any code changes.${rawSessionCost > 0 ? `\n\n**Total Cost:** $${rawSessionCost.toFixed(4)}` : ''}`
                                });
                            }
                        } catch (error: any) {
                            console.error(`[opencode-agent] Failed to create PR for ticket ${ticket.id}`, error);
                            commentRepository.create({
                                ticketId: ticket.id,
                                author: 'System',
                                content: `❌ **Failed to Create PR**\n\nThe agent finished the task, but an error occurred while pushing changes or creating the PR:\n\`\`\`\n${error.message}\n\`\`\``
                            });
                        }

                        // Move ticket to the configured destination column (if set)
                        if (config.on_finish_column_id) {
                            console.log(`[opencode-agent] Moving ticket ${ticket.id} to column ${config.on_finish_column_id}`);
                            const moved = ticketRepository.move(ticket.id, config.on_finish_column_id, 0);
                            if (moved) {
                                // Trigger via the queue so concurrency/priority rules are respected
                                agentQueue.evaluateColumnQueue(config.on_finish_column_id);
                            }
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
                const partID = (event as any).properties.partID;
                const delta = (event as any).properties.delta;

                // To know if this part is 'text', we check if we've seen it as text in a part.updated
                // or if it belongs to an assistant message we want to track.
                // However, to satisfy "one comment per section", we should group by messageID.
                const messageID = (event.properties as any).messageID;

                if (delta && messageID) {
                    let tracking = activeParts.get(messageID);
                    if (!tracking) {
                        // create initial comment
                        const comment = commentRepository.create({
                            ticketId: ticket.id,
                            author: 'opencode',
                            content: delta
                        });
                        tracking = { commentId: comment.id, fullText: delta };
                        activeParts.set(messageID, tracking);
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
