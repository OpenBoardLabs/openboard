import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import fg from 'fast-glob';

import { normalizePathForOS } from '../utils/os.js';

const router = Router();

interface DirectoryEntry {
    name: string;
    path: string;
    isRepo: boolean;
    hasSrc: boolean;
    hasPublic: boolean;
    isDir: boolean;
}

async function getWindowsDrives(): Promise<string[]> {
    const drives: string[] = [];
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const letter of alphabet) {
        const drive = `${letter}:`;
        try {
            fs.accessSync(drive + path.sep);
            drives.push(drive);
        } catch {
            // Drive not accessible or doesn't exist
        }
    }
    return drives;
}

router.get('/browse', async (req: Request, res: Response) => {
    let currentPath = normalizePathForOS((req.query.path as string) || '');

    try {
        if (!currentPath && process.platform === 'win32') {
            const drives = await getWindowsDrives();
            const entries = drives.map(drive => ({
                name: drive,
                path: drive + '\\',
                isRepo: false,
                hasSrc: false,
                hasPublic: false,
                isDir: true
            }));
            res.json({ currentPath: '', entries });
            return;
        }

        if (!currentPath) {
            currentPath = '/';
        }

        const items = await fs.promises.readdir(currentPath, { withFileTypes: true });
        const entries: DirectoryEntry[] = [];

        for (const item of items) {
            if (!item.isDirectory()) continue;

            const fullPath = path.join(currentPath, item.name);
            let isRepo = false;
            let hasSrc = false;
            let hasPublic = false;

            try {
                const subItems = await fs.promises.readdir(fullPath);
                isRepo = subItems.includes('.git');
                hasSrc = subItems.includes('src');
                hasPublic = subItems.includes('public');
            } catch {
                // Ignore errors (e.g. permission denied)
            }

            entries.push({
                name: item.name,
                path: fullPath,
                isRepo,
                hasSrc,
                hasPublic,
                isDir: true
            });
        }

        // Sorting: Repos first, then alphabetical
        entries.sort((a, b) => {
            if (a.isRepo && !b.isRepo) return -1;
            if (!a.isRepo && b.isRepo) return 1;
            return a.name.localeCompare(b.name);
        });

        res.json({ currentPath, entries });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/search', async (req: Request, res: Response) => {
    const query = (req.query.query as string || '').toLowerCase();
    const basePath = normalizePathForOS((req.query.basePath as string) || '');

    if (!query || !basePath) {
        res.json([]);
        return;
    }

    try {
        const items = await fs.promises.readdir(basePath, { withFileTypes: true });
        const results = [];

        for (const item of items) {
            if (!item.isDirectory()) continue;
            if (item.name.toLowerCase().includes(query)) {
                const fullPath = path.join(basePath, item.name);
                let isRepo = false;
                let hasSrc = false;
                let hasPublic = false;
                try {
                    const subItems = await fs.promises.readdir(fullPath);
                    isRepo = subItems.includes('.git');
                    hasSrc = subItems.includes('src');
                    hasPublic = subItems.includes('public');
                } catch {}

                results.push({
                    name: item.name,
                    path: fullPath,
                    isRepo,
                    hasSrc,
                    hasPublic,
                    isDir: true
                });
            }
        }
        res.json(results);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/search/global', async (req: Request, res: Response) => {
    const query = (req.query.query as string || '').toLowerCase();
    if (!query || query.length < 2) {
        res.json([]);
        return;
    }

    try {
        // Start search from home directory
        const homeDir = os.homedir();
        // Use fast-glob to find directories matching query
        // Limit depth and results for performance
        const pattern = `*${query}*`;
        const matches = await fg(pattern, {
            cwd: homeDir,
            onlyDirectories: true,
            unique: true,
            absolute: true,
            deep: 3, // Depth limit
            ignore: ['**/node_modules/**', '**/.*/**']
        });

        const results: DirectoryEntry[] = [];
        const limitedMatches = matches.slice(0, 50); // Result limit

        for (const fullPath of limitedMatches) {
            const name = path.basename(fullPath);
            let isRepo = false;
            let hasSrc = false;
            let hasPublic = false;

            try {
                const subItems = await fs.promises.readdir(fullPath);
                isRepo = subItems.includes('.git');
                hasSrc = subItems.includes('src');
                hasPublic = subItems.includes('public');
            } catch {}

            results.push({
                name,
                path: fullPath,
                isRepo,
                hasSrc,
                hasPublic,
                isDir: true
            });
        }

        res.json(results);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export { router as systemRouter };
