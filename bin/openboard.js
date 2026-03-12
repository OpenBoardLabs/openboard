#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

function checkDependencies() {
    const deps = ['git', 'gh', 'opencode'];
    for (const dep of deps) {
        try {
            execSync(`${dep} --version`, { stdio: 'ignore' });
        } catch (err) {
            console.error(`Error: Required dependency '${dep}' is not installed or not in PATH.`);
            process.exit(1);
        }
    }
}

function startOpencode() {
    console.log('[openboard] Starting opencode serve...');

    // We run it detached if want, or just spawn it
    const child = spawn('opencode', ['serve'], { stdio: ['ignore', 'pipe', 'pipe'] });

    return new Promise((resolve, reject) => {
        let output = '';
        let portFound = false;

        child.stdout.on('data', (data) => {
            const str = data.toString();
            output += str;
            // opencode logs its url, e.g., "Server running at http://127.0.0.1:4096"
            // Let's print opencode output for now so user can see it
            process.stdout.write(`[opencode] ${str}`);

            if (!portFound) {
                const match = output.match(/http:\/\/.*:(\d+)/);
                if (match) {
                    portFound = true;
                    process.env.OPENCODE_PORT = match[1];
                    console.log(`[openboard] opencode running on port ${match[1]}`);
                    resolve(child);
                }
            }
        });

        child.stderr.on('data', (data) => {
            process.stderr.write(`[opencode ERR] ${data}`);
        });

        child.on('error', (err) => {
            console.error('[openboard] Failed to start opencode', err);
            reject(err);
        });

        child.on('exit', (code) => {
            if (!portFound) {
                reject(new Error(`opencode exited with code ${code} before printing port.`));
            }
        });
    });
}

async function main() {
    checkDependencies();
    const opencodeProcess = await startOpencode();

    console.log('[openboard] Starting openboard server...');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    process.env.NODE_ENV = 'production';
    process.env.PORT = process.env.PORT || '3001';

    // Import the compiled server index file
    try {
        await import(path.join(__dirname, '../packages/server/dist/index.js'));
        
        // Give the server a moment to start
        setTimeout(async () => {
            const currentPath = process.cwd();
            // We use fetch since the server is running in this process or another
            try {
                const res = await fetch(`http://localhost:${process.env.PORT}/api/boards`);
                if (res.ok) {
                    const boards = await res.json();
                    // Find board with this path. Normalize windows paths for comparison.
                    const normalize = (p) => p.replace(/\\/g, '/').toLowerCase();
                    const board = boards.find(b => b.path && normalize(b.path) === normalize(currentPath));
                    
                    const open = (await import('open')).default;
                    const url = board ? `http://localhost:${process.env.PORT}/boards/${board.id}` : `http://localhost:${process.env.PORT}/`;
                    console.log(`[openboard] Opening browser to ${url}`);
                    await open(url);
                }
            } catch (e) {
                console.error('[openboard] Could not detect board or open browser:', e);
            }
        }, 1000);

    } catch (e) {
        console.error('[openboard] Error starting server. Did you run `npm run build`? Full Error:', e);
        if (opencodeProcess) opencodeProcess.kill();
        process.exit(1);
    }

    process.on('SIGINT', () => {
        if (opencodeProcess) opencodeProcess.kill();
        process.exit(0);
    });
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
