// @app/daemon entrypoint — privileged local background process.
// Binds to loopback only (local-first; never exposed). Port/host configurable via env.

import { createServer } from './server.js';
import { logger } from './logger.js';

const PORT = Number(process.env.PORT ?? 4319);
const HOST = process.env.HOST ?? '127.0.0.1';

const app = createServer();
const server = app.listen(PORT, HOST, () => {
  logger.info({ host: HOST, port: PORT }, 'daemon listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
