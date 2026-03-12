import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/**
 * Normalizes paths for mixed environments (e.g. WSL-style paths in a Windows process).
 */
export function normalizePathForOS(p: string): string {
    if (!p) return p;
    let normalized = p;
    if (process.platform === 'win32') {
        // Convert all forward slashes to backslashes first for consistency on Windows
        normalized = normalized.replace(/\//g, '\\');
        // Match \mnt\c\... or /mnt/c/... (case insensitive)
        const mntMatch = normalized.match(/^[\\\/]mnt[\\\/]([a-z])([\\\/]|$)/i);
        if (mntMatch) {
            const drive = mntMatch[1].toUpperCase();
            // Remove the /mnt/c/ prefix
            const rest = normalized.substring(mntMatch[0].length);
            normalized = `${drive}:\\${rest}`;
        }
    } else {
        normalized = normalized.replace(/\\/g, '/');
    }
    return normalized;
}

// Cache the gh token so we only fetch it once per server process
let cachedGhToken: string | null = null;
export async function getGhToken(cwd: string): Promise<string | null> {
    if (cachedGhToken !== null) return cachedGhToken;
    try {
        const { stdout } = await execFileAsync('gh', ['auth', 'token'], { cwd: normalizePathForOS(cwd), shell: true });
        cachedGhToken = stdout.trim() || null;
    } catch {
        cachedGhToken = null;
    }
    return cachedGhToken;
}

/**
 * Helper function to execute commands robustly across OS.
 * Automatically injects GH_TOKEN for any `gh` subcommand and handles shell execution on Windows.
 */
export async function runCmd(cmd: string, args: string[], cwd: string, prefix = ''): Promise<{ stdout: string, stderr: string }> {
    const normalizedCwd = normalizePathForOS(cwd);
    console.log(`[${prefix || 'os-util'}] Running: ${cmd} ${args.join(' ')} in cwd: ${normalizedCwd}`);

    // Safety check for CWD
    if (!fs.existsSync(normalizedCwd)) {
        throw new Error(`Directory does not exist: ${normalizedCwd}`);
    }

    let extraEnv: Record<string, string> = {};
    if (cmd === 'gh') {
        const token = await getGhToken(normalizedCwd);
        if (token) extraEnv['GH_TOKEN'] = token;
    }
    const env = { ...process.env, ...extraEnv };

    try {
        // use shell: true to help find binaries in PATH on Windows
        return await execFileAsync(cmd, args, { cwd: normalizedCwd, env, shell: true });
    } catch (e: any) {
        if (e.code === 'ENOENT') {
            const envPrefix = extraEnv['GH_TOKEN'] ? (process.platform === 'win32' ? `set GH_TOKEN=${extraEnv['GH_TOKEN']}&& ` : `GH_TOKEN=${extraEnv['GH_TOKEN']} `) : '';
            return await execAsync(`${envPrefix}${cmd} ${args.join(' ')}`, { cwd: normalizedCwd });
        }
        throw e;
    }
}
