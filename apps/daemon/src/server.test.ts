import { describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createServer } from './server.js';

async function listen(): Promise<{ port: number; close: () => void }> {
  const app = createServer();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return { port, close: () => server.close() };
}

describe('daemon /api/health', () => {
  it('returns 200 with an ok Health body', async () => {
    const { port, close } = await listen();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; version: string; uptimeMs: number };
      expect(body.status).toBe('ok');
      expect(typeof body.version).toBe('string');
      expect(typeof body.uptimeMs).toBe('number');
    } finally {
      close();
    }
  });

  it('404s unknown routes', async () => {
    const { port, close } = await listen();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/nope`);
      expect(res.status).toBe(404);
    } finally {
      close();
    }
  });
});
