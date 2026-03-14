import { ChildProcess } from 'child_process';

/**
 * Manages background processes (opencode serve) for each active agent session.
 */
class ProcessRegistry {
    private processes: Map<string, ChildProcess> = new Map();

    register(ticketId: string, process: ChildProcess) {
        // Kill existing process if it exists
        this.kill(ticketId);
        this.processes.set(ticketId, process);
        
        process.on('exit', () => {
            if (this.processes.get(ticketId) === process) {
                this.processes.delete(ticketId);
            }
        });
    }

    kill(ticketId: string) {
        const process = this.processes.get(ticketId);
        if (process) {
            console.log(`[process-registry] Killing process for ticket ${ticketId}`);
            process.kill('SIGTERM');
            this.processes.delete(ticketId);
        }
    }

    get(ticketId: string): ChildProcess | undefined {
        return this.processes.get(ticketId);
    }
}

export const processRegistry = new ProcessRegistry();
