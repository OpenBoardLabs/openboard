import { ticketRepository } from '../repositories/ticket.repository.js';
import { commentRepository } from '../repositories/comment.repository.js';
import type { Ticket, ColumnConfig } from '../types.js';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Helper function to execute commands robustly on Windows
async function runCmd(cmd: string, args: string[], cwd: string): Promise<{ stdout: string, stderr: string }> {
    console.log(`[opencode-agent] Running: ${cmd} ${args.join(' ')} in cwd: ${cwd}`);
    try {
        return await execFileAsync(cmd, args, { cwd, shell: true });
    } catch (e: any) {
        if (e.code === 'ENOENT') {
            console.log(`[opencode-agent] ENOENT with shell: true. Trying fallback exec...`);
            return await execAsync(`${cmd} ${args.join(' ')}`, { cwd });
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
                    agent_type: 'opencode',
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
                    agent_type: 'opencode',
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
                        agent_type: agentType,
                        status: 'done',
                        port: 4096,
                        url: agentUrl
                    });

                    if (agentType === 'code_review') {
                        try {
                            // Find out if the PR was approved or changes requested
                            const prUrlSession = [...(ticket.agent_sessions || [])].reverse().find(s => s.pr_url);
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
                                            import('./agent-runner.js').then(({ triggerAgent }) => {
                                                triggerAgent(moved);
                                            }).catch(err => console.error("Failed to trigger agent runner", err));
                                        }
                                    }
                                } else if (reviewDecision === 'CHANGES_REQUESTED') {
                                    commentRepository.create({
                                        ticketId: ticket.id,
                                        author: 'System',
                                        content: `⚠️ **Changes Requested**\n\nThe agent has requested changes on the PR. Sending ticket back for revision.`
                                    });

                                    // Find the previous column the ticket was in BEFORE reaching this column
                                    const previousSession = [...(ticket.agent_sessions || [])].reverse().find(s => s.column_id !== ticket.column_id);
                                    if (previousSession) {
                                        console.log(`[codereview-agent] Moving ticket ${ticket.id} back to previous column ${previousSession.column_id}`);
                                        const moved = ticketRepository.move(ticket.id, previousSession.column_id, 0);
                                        if (moved) {
                                            // Ensure the 'done' state for the opencode agent in that column is removed
                                            const updatedSessions = moved.agent_sessions.filter(s => !(s.column_id === previousSession.column_id && (s.status === 'blocked' || s.status === 'done')));
                                            moved.agent_sessions = updatedSessions;
                                            import('../db/database.js').then(({ getDb }) => {
                                                getDb().prepare('UPDATE tickets SET agent_sessions = ? WHERE id = ?').run(JSON.stringify(updatedSessions), moved.id);
                                            });

                                            import('./agent-runner.js').then(({ triggerAgent }) => {
                                                triggerAgent(moved, true); // Re-trigger the dev agent with force=true to ignore 'done' history
                                            }).catch(err => console.error("Failed to trigger agent runner", err));
                                        }
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

                                // Authenticate git push using gh token
                                try {
                                    const { stdout: ghToken } = await runCmd('gh', ['auth', 'token'], worktreePath);
                                    const token = ghToken.trim();
                                    if (token) {
                                        const { stdout: remoteUrlOut } = await runCmd('git', ['config', '--get', 'remote.origin.url'], worktreePath);
                                        let remoteUrl = remoteUrlOut.trim();
                                        if (remoteUrl.startsWith('https://github.com/')) {
                                            remoteUrl = remoteUrl.replace('https://github.com/', `https://x-access-token:${token}@github.com/`);
                                            await runCmd('git', ['remote', 'set-url', 'origin', remoteUrl], worktreePath);
                                        }
                                    }
                                } catch (authErr) {
                                    console.warn(`[opencode-agent] Could not inject GH auth token:`, authErr);
                                }

                                await runCmd('git', ['push', '-u', 'origin', branchName], worktreePath);

                                const { stdout: prOut } = await runCmd('gh', ['pr', 'create', '--title', `"${ticket.title.replace(/"/g, '\\"')}"`, '--body', `"Automated PR from OpenCode Agent for ticket #${ticket.id}"`], worktreePath);

                                const prUrl = prOut.trim();

                                commentRepository.create({
                                    ticketId: ticket.id,
                                    author: 'System',
                                    content: `🚀 **Pull Request Created**\n\nThe agent has proposed the following changes in a PR. Check it out:\n${prUrl}`
                                });

                                // Add PR URL to the active agent session so the UI displays the code review button
                                ticketRepository.updateAgentSession(ticket.id, {
                                    column_id: ticket.column_id,
                                    agent_type: 'opencode',
                                    status: 'done',
                                    port: 4096,
                                    url: agentUrl,
                                    pr_url: prUrl
                                });
                            } else {
                                console.log(`[opencode-agent] No changes to push for ticket ${ticket.id}.`);
                                commentRepository.create({
                                    ticketId: ticket.id,
                                    author: 'System',
                                    content: `ℹ️ **Task Completed (No Changes)**\n\nThe agent finished the task but did not make any code changes.`
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
                                import('./agent-runner.js').then(({ triggerAgent }) => {
                                    triggerAgent(moved);
                                }).catch(err => console.error("Failed to trigger agent runner", err));
                            }
                        }
                    } // End of agentType === 'opencode' block
                }

                // Cleanup worktree
                try {
                    console.log(`[opencode-agent] Removing worktree ${worktreePath}`);
                    await runCmd('git', ['worktree', 'remove', '--force', worktreePath], originalWorkspacePath);
                    await runCmd('git', ['branch', '-D', branchName], originalWorkspacePath).catch(() => { }); // Attempt to delete local branch too
                } catch (cleanupError: any) {
                    console.error(`[opencode-agent] Failed to cleanup worktree ${worktreePath}`, cleanupError);
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
