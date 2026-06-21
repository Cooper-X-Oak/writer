import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { WriteStreamEvent } from '@app/contracts';
import { createWriteRouter, type WriteEngine } from './write.js';

function serve(engine: WriteEngine): Promise<{ url: string; close: () => void }> {
  const app = express();
  app.use(express.json());
  app.use('/api', createWriteRouter(engine));
  return new Promise((resolve) => {
    const server: Server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/api/agent/write`, close: () => server.close() });
    });
  });
}

async function readSse(url: string, body: unknown): Promise<WriteStreamEvent[]> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return text
    .split('\n\n')
    .map((f) => f.split('\n').find((l) => l.startsWith('data:')))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice(5).trim()) as WriteStreamEvent);
}

describe('POST /api/agent/write', () => {
  it('rejects a missing topic with 400', async () => {
    const { url, close } = await serve(() => ({ abort() {} }));
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    } finally {
      close();
    }
  });

  it('streams status, deltas, then done as SSE', async () => {
    const engine: WriteEngine = (topic, cb) => {
      cb.onStatus('writing');
      cb.onDelta('稿子：');
      cb.onDelta(topic);
      cb.onDone(0.0123);
      return { abort() {} };
    };
    const { url, close } = await serve(engine);
    try {
      const events = await readSse(url, { topic: '热点' });
      expect(events).toEqual([
        { type: 'status', message: 'writing' },
        { type: 'delta', text: '稿子：' },
        { type: 'delta', text: '热点' },
        { type: 'done', costUsd: 0.0123 },
      ]);
    } finally {
      close();
    }
  });

  it('still streams when the engine starts asynchronously (req-body-close must not abort)', async () => {
    // Regression: the disconnect listener must key off res 'close', not req 'close' — the latter
    // fires when express.json() finishes reading the body, which would abort every async run.
    const engine: WriteEngine = (topic, cb) => {
      setTimeout(() => {
        cb.onStatus('writing');
        cb.onDelta(topic);
        cb.onDone();
      }, 60);
      return { abort() {} };
    };
    const { url, close } = await serve(engine);
    try {
      const events = await readSse(url, { topic: '迟到' });
      expect(events).toEqual([
        { type: 'status', message: 'writing' },
        { type: 'delta', text: '迟到' },
        { type: 'done' },
      ]);
    } finally {
      close();
    }
  });

  it('forwards an error event', async () => {
    const engine: WriteEngine = (_topic, cb) => {
      cb.onError('Claude Code is not installed');
      return { abort() {} };
    };
    const { url, close } = await serve(engine);
    try {
      const events = await readSse(url, { topic: 'x' });
      expect(events).toEqual([{ type: 'error', message: 'Claude Code is not installed' }]);
    } finally {
      close();
    }
  });

  it('aborts the run when the client disconnects', async () => {
    let aborted = false;
    const engine: WriteEngine = (_topic, cb) => {
      cb.onStatus('writing'); // emit then hang (never onDone)
      return {
        abort() {
          aborted = true;
        },
      };
    };
    const { url, close } = await serve(engine);
    const controller = new AbortController();
    try {
      const req = fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: 'x' }),
        signal: controller.signal,
      }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 80));
      controller.abort();
      await req;
      // give the server a tick to observe the closed connection
      for (let i = 0; i < 40 && !aborted; i += 1) await new Promise((r) => setTimeout(r, 25));
      expect(aborted).toBe(true);
    } finally {
      close();
    }
  });
});
