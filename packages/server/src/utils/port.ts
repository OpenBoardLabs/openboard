import net from 'net';

/**
 * Finds an available TCP port starting from the given port.
 */
export async function findFreePort(startPort: number = 4096): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();

        server.on('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
                resolve(findFreePort(startPort + 1));
            } else {
                reject(err);
            }
        });

        server.listen(startPort, '127.0.0.1', () => {
            const { port } = server.address() as net.AddressInfo;
            server.close(() => resolve(port));
        });
    });
}
