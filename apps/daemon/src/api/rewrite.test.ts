import { describe, it, expect } from 'vitest';
import express from 'express';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { spawn as nodeSpawn } from 'node:child_process';
import type { DetectResult } from '@app/agent-defs';
import { createDefaultRewriteEngine, createRewriteRouter, type RewriteEngine } from './rewrite.js';

// ---- route ----
function serve(engine: RewriteEngine): Promise<{ url: string; close: () => void }> {
  const app = express();
  app.use(express.json());
  app.use('/api', createRewriteRouter(engine));
  return new Promise((resolve) => {
    const server: Server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/api/agent/rewrite`, close: () => server.close() });
    });
  });
}
async function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/agent/rewrite', () => {
  it('returns the rewritten text', async () => {
    const { url, close } = await serve(({ blockText, instruction }) =>
      Promise.resolve(`[${instruction}] ${blockText}`),
    );
    try {
      const res = await post(url, { blockText: '原文', instruction: '更短' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ text: '[更短] 原文' });
    } finally {
      close();
    }
  });

  it('rejects a missing blockText with 400', async () => {
    const { url, close } = await serve(() => Promise.resolve('x'));
    try {
      expect((await post(url, { instruction: 'x' })).status).toBe(400);
    } finally {
      close();
    }
  });

  it('maps an engine failure to 502 with the message', async () => {
    const { url, close } = await serve(() => Promise.reject(new Error('agent not ready')));
    try {
      const res = await post(url, { blockText: 'x' });
      expect(res.status).toBe(502);
      expect((await res.json()) as { error: string }).toEqual({ error: 'agent not ready' });
    } finally {
      close();
    }
  });
});

// ---- default engine (fake CLI) ----
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter & { setEncoding: () => void };
    stderr: EventEmitter & { setEncoding: () => void };
    stdin: EventEmitter & { writable: boolean; write: () => void; end: () => void };
    kill: () => boolean;
  };
  child.pid = 4242;
  const mk = () => Object.assign(new EventEmitter(), { setEncoding: () => undefined });
  child.stdout = mk();
  child.stderr = mk();
  child.stdin = Object.assign(new EventEmitter(), { writable: true, write: () => undefined, end: () => undefined });
  child.kill = () => {
    child.emit('close', null, 'SIGTERM');
    return true;
  };
  return child;
}
const READY: DetectResult = { state: 'READY', version: '2.1.185' };
const textDelta = (t: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } }) + '\n';
const resultLine = (isError: boolean) =>
  JSON.stringify({ type: 'result', subtype: isError ? 'error' : 'success', is_error: isError }) + '\n';

async function runEngine(
  detectResult: DetectResult,
  script: (child: ReturnType<typeof fakeChild>) => void,
): Promise<{ text?: string; error?: string; spCleaned: boolean; spawnArgs: string[] }> {
  let child: ReturnType<typeof fakeChild> | undefined;
  const out = { spCleaned: false, spawnArgs: [] as string[] } as {
    text?: string;
    error?: string;
    spCleaned: boolean;
    spawnArgs: string[];
  };
  const spawnImpl = ((_bin: string, args: string[]) => {
    out.spawnArgs = args;
    child = fakeChild();
    return child;
  }) as unknown as typeof nodeSpawn;

  const engine = createDefaultRewriteEngine({
    detect: () => Promise.resolve(detectResult),
    spawnImpl,
    shell: false,
    inactivityMs: 0,
    prepareSystemPrompt: () => Promise.resolve({ path: '/fake/sp.md', cleanup: () => (out.spCleaned = true) }),
  });

  await new Promise<void>((resolve) => {
    engine({ blockText: '原文', instruction: '更短' })
      .then((t) => {
        out.text = t;
        resolve();
      })
      .catch((e: unknown) => {
        out.error = e instanceof Error ? e.message : String(e);
        resolve();
      });
    setTimeout(() => {
      if (child) script(child);
    }, 10);
  });
  return out;
}

describe('createDefaultRewriteEngine', () => {
  it('resolves with the trimmed accumulated text, passing the system prompt and cleaning it up', async () => {
    const out = await runEngine(READY, (child) => {
      child.stdout.emit('data', textDelta('改写后的'));
      child.stdout.emit('data', textDelta('一段。'));
      child.stdout.emit('data', resultLine(false));
      child.emit('close', 0, null);
    });
    expect(out.text).toBe('改写后的一段。');
    expect(out.error).toBeUndefined();
    expect(out.spawnArgs.join(' ')).toContain('--append-system-prompt-file /fake/sp.md');
    expect(out.spCleaned).toBe(true);
  });

  it('rejects when the agent is not READY (no spawn)', async () => {
    const out = await runEngine({ state: 'NOT_INSTALLED' }, () => undefined);
    expect(out.text).toBeUndefined();
    expect(out.error).toContain('not installed');
  });

  it('rejects on a non-zero exit', async () => {
    const out = await runEngine(READY, (child) => {
      child.stderr.emit('data', 'boom\n');
      child.emit('close', 1, null);
    });
    expect(out.text).toBeUndefined();
    expect(out.error).toContain('exited unexpectedly');
  });
});
