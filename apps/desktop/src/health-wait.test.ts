import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { waitForHealth } from './health-wait.js';

describe('waitForHealth', () => {
  it('resolves once the daemon reports ok', async () => {
    let ready = false;
    const server = createServer((_req, res) => {
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: ready ? 'ok' : 'starting' }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    setTimeout(() => {
      ready = true;
    }, 150);
    try {
      await waitForHealth(`http://127.0.0.1:${port}/api/health`, { timeoutMs: 3000, intervalMs: 50 });
      expect(ready).toBe(true);
    } finally {
      server.close();
    }
  });

  it('rejects on timeout when never healthy', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(503);
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(
        waitForHealth(`http://127.0.0.1:${port}/api/health`, { timeoutMs: 300, intervalMs: 50 }),
      ).rejects.toThrow(/not ready/);
    } finally {
      server.close();
    }
  });
});
