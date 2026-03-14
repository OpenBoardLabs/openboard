import { createOpencodeClient } from '@opencode-ai/sdk';

const opencodePort = process.env.OPENCODE_PORT || 4096;

/**
 * Creates an Opencode client instance scoped to a specific board directory.
 */
export function createBoardScopedClient(boardPath?: string, port: number | string = opencodePort) {
    return createOpencodeClient({
        baseUrl: `http://127.0.0.1:${port}`,
        directory: boardPath
    });
}
