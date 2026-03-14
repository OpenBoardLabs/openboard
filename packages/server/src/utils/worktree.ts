import path from 'path';
import fs from 'fs';
import { normalizePathForOS, runCmd } from './os.js';

export interface EnsureWorktreeParams {
    /** Board/repo root path */
    workspacePath: string;
    ticketId: string;
    /** If set, reuse this PR's branch when creating worktree */
    existingPrUrl?: string | null;
    /** Log prefix for console (e.g. 'opencode-agent', 'cursor-agent') */
    logLabel: string;
}

export interface EnsureWorktreeResult {
    worktreePath: string;
    branchName: string;
}

/**
 * Create or reuse a git worktree for a ticket.
 * Used by both OpenCode and Cursor agents so worktree layout is consistent.
 * @throws Error if git worktree creation fails
 */
export async function ensureWorktree(params: EnsureWorktreeParams): Promise<EnsureWorktreeResult> {
    const { workspacePath, ticketId, existingPrUrl, logLabel } = params;
    const originalWorkspacePath = normalizePathForOS(workspacePath);

    let branchName: string;
    if (existingPrUrl) {
        try {
            const { stdout: prDataStr } = await runCmd('gh', ['pr', 'view', existingPrUrl, '--json', 'headRefName'], originalWorkspacePath, logLabel);
            const prData = JSON.parse(prDataStr);
            if (!prData.headRefName) throw new Error('Could not parse headRefName from PR');
            branchName = prData.headRefName;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[${logLabel}] Could not read PR branch name, will create a new branch.`, msg);
            branchName = `ticket-${ticketId}-${Date.now()}`;
        }
    } else {
        branchName = `ticket-${ticketId}-${Date.now()}`;
    }

    const worktreePath = normalizePathForOS(path.join(originalWorkspacePath, '.openboard-worktrees', branchName));

    if (fs.existsSync(worktreePath)) {
        console.log(`[${logLabel}] Reusing existing worktree at ${worktreePath} (branch: ${branchName})`);
        return { worktreePath, branchName };
    }

    if (existingPrUrl) {
        console.log(`[${logLabel}] Checking out existing branch ${branchName} into new worktree at ${worktreePath}`);
        await runCmd('git', ['worktree', 'add', worktreePath, branchName], originalWorkspacePath, logLabel);
        return { worktreePath, branchName };
    }

    let isRepoEmpty = false;
    try {
        await runCmd('git', ['rev-parse', 'HEAD'], originalWorkspacePath, logLabel);
    } catch {
        isRepoEmpty = true;
        console.log(`[${logLabel}] Repository appears to be empty. Using --orphan for worktree.`);
    }

    if (isRepoEmpty) {
        console.log(`[${logLabel}] Creating new orphan worktree at ${worktreePath} on branch ${branchName}`);
        await runCmd('git', ['worktree', 'add', '--orphan', '-b', branchName, worktreePath], originalWorkspacePath, logLabel);
    } else {
        console.log(`[${logLabel}] Creating new worktree at ${worktreePath} on branch ${branchName}`);
        await runCmd('git', ['worktree', 'add', '-b', branchName, worktreePath], originalWorkspacePath, logLabel);
    }

    return { worktreePath, branchName };
}
