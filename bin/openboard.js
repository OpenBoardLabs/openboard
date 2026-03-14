#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerInterval = null;

function startSpinner(text) {
    let frame = 0;
    process.stdout.write(`${CYAN}${SPINNER_FRAMES[frame]}${RESET} ${text}`);
    spinnerInterval = setInterval(() => {
        process.stdout.write('\r' + ' '.repeat(20));
        frame = (frame + 1) % SPINNER_FRAMES.length;
        process.stdout.write(`\r${CYAN}${SPINNER_FRAMES[frame]}${RESET} ${text}`);
    }, 100);
}

function stopSpinner(text, success = true) {
    if (spinnerInterval) {
        clearInterval(spinnerInterval);
        spinnerInterval = null;
    }
    process.stdout.write('\r' + ' '.repeat(25));
    const icon = success ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    const color = success ? GREEN : RED;
    process.stdout.write(`\r${icon} ${color}${text}${RESET}\n`);
}

function printCheck(text) {
    console.log(`${GREEN}✓${RESET} ${text}`);
}

function printInfo(text) {
    console.log(`${BLUE}ℹ${RESET} ${text}`);
}

function printWarn(text) {
    console.log(`${YELLOW}⚠${RESET} ${YELLOW}${text}${RESET}`);
}

function printError(text) {
    console.error(`${RED}✗${RESET} ${RED}${text}${RESET}`);
}

function execCommand(cmd, options = {}) {
    return execSync(cmd, { stdio: 'pipe', ...options }).toString().trim();
}

function checkDependencies() {
    const deps = ['git', 'gh'];
    for (const dep of deps) {
        try {
            execCommand(`${dep} --version`);
        } catch (err) {
            printError(`Required dependency '${dep}' is not installed or not in PATH.`);
            process.exit(1);
        }
    }
}

function installOpencode() {
    printInfo('opencode not found. Installing...');
    startSpinner('Installing opencode');
    
    try {
        execCommand('curl -fsSL https://opencode.ai/install | bash', { stdio: 'inherit' });
        stopSpinner('opencode installed', true);
    } catch (err) {
        stopSpinner('Failed to install opencode', false);
        printError('Could not install opencode. Please install it manually: curl -fsSL https://opencode.ai/install | bash');
        process.exit(1);
    }
}

function checkOpencode() {
    try {
        execCommand('opencode --version');
        printCheck('opencode is installed');
        return true;
    } catch (err) {
        return false;
    }
}

function checkGitHubAuth() {
    printInfo('Checking GitHub authentication status...');
    
    try {
        const status = execCommand('gh auth status');
        
        if (status.includes('Logged in to github.com')) {
            printCheck('GitHub authenticated');
            return true;
        }
    } catch (err) {
    }
    
    printWarn('GitHub authentication not detected');
    printWarn('Agents will not be able to create PRs without authentication');
    printInfo('Run "gh auth login" to authenticate with GitHub');
    return false;
}

function startOpencode() {
    console.log(`${BOLD}[openboard]${RESET} Starting opencode serve...`);

    const child = spawn('opencode', ['serve'], { stdio: ['ignore', 'pipe', 'pipe'] });

    return new Promise((resolve, reject) => {
        let output = '';
        let portFound = false;

        child.stdout.on('data', (data) => {
            const str = data.toString();
            output += str;
            process.stdout.write(`${CYAN}[opencode]${RESET} ${str}`);

            if (!portFound) {
                const match = output.match(/http:\/\/.*:(\d+)/);
                if (match) {
                    portFound = true;
                    process.env.OPENCODE_PORT = match[1];
                    console.log(`${GREEN}[opencode]${RESET} opencode running on port ${match[1]}`);
                    resolve(child);
                }
            }
        });

        child.stderr.on('data', (data) => {
            process.stderr.write(`${RED}[opencode ERR]${RESET} ${data}`);
        });

        child.on('error', (err) => {
            printError(`Failed to start opencode: ${err.message}`);
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
    console.log(`${BOLD}${BLUE}╔════════════════════════════════════╗${RESET}`);
    console.log(`${BOLD}${BLUE}║         OpenBoard Launcher         ║${RESET}`);
    console.log(`${BOLD}${BLUE}╚════════════════════════════════════╝${RESET}\n`);
    
    checkDependencies();
    
    if (!checkOpencode()) {
        installOpencode();
    }
    
    checkGitHubAuth();
    
    console.log('');
    const opencodeProcess = await startOpencode();

    console.log(`${BOLD}[openboard]${RESET} Starting openboard server...`);
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    process.env.NODE_ENV = 'production';
    process.env.PORT = process.env.PORT || '4199';

    try {
        await import(path.join(__dirname, '../packages/server/dist/index.js'));
        
        setTimeout(async () => {
            const currentPath = process.cwd();
            try {
                const res = await fetch(`http://localhost:${process.env.PORT}/api/boards`);
                if (res.ok) {
                    const boards = await res.json();
                    const normalize = (p) => p.replace(/\\/g, '/').toLowerCase();
                    const board = boards.find((b) => b.path && normalize(b.path) === normalize(currentPath));
                    
                    const open = (await import('open')).default;
                    const url = board ? `http://localhost:${process.env.PORT}/boards/${board.id}` : `http://localhost:${process.env.PORT}/`;
                    console.log(`${GREEN}[openboard]${RESET} Opening browser to ${url}`);
                    await open(url);
                }
            } catch (e) {
                printError(`Could not detect board or open browser: ${e}`);
            }
        }, 1000);

    } catch (e) {
        printError(`Error starting server. Did you run \`npm run build\`? Full Error: ${e}`);
        if (opencodeProcess) opencodeProcess.kill();
        process.exit(1);
    }

    process.on('SIGINT', () => {
        if (opencodeProcess) opencodeProcess.kill();
        process.exit(0);
    });
}

main().catch(err => {
    printError(err.message);
    process.exit(1);
});
