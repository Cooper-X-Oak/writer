import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import type { spawn as nodeSpawn } from 'node:child_process';
import type { DetectResult } from '@app/agent-defs';
import { createDefaultEngine } from './write.js';

// A minimal fake ChildProcess the runner can drive: EventEmitter for the process, plus stdout/stderr
// emitters and a stdin stub. kill() emits a close so abort/timeout terminate deterministically.
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter & { setEncoding: () => void };
    stderr: EventEmitter & { setEncoding: () => void };
    stdin: { writable: boolean; write: () => void; end: () => void };
    kill: (signal?: string) => boolean;
  };
  child.pid = 4242;
  const mkStream = () => Object.assign(new EventEmitter(), { setEncoding: () => undefined });
  child.stdout = mkStream();
  child.stderr = mkStream();
  child.stdin = { writable: true, write: () => undefined, end: () => undefined };
  child.kill = () => {
    child.emit('close', null, 'SIGTERM');
    return true;
  };
  return child;
}

const READY: DetectResult = { state: 'READY', version: '2.1.185' };

interface Captured {
  status: string[];
  deltas: string[];
  done: { called: boolean; cost?: number };
  error?: string;
}

// Run the engine against a fake spawn; `script` drives the captured child once it's spawned.
async function run(
  detectResult: DetectResult,
  script: (child: ReturnType<typeof fakeChild>) => void,
): Promise<Captured> {
  let child: ReturnType<typeof fakeChild> | undefined;
  const spawnImpl = ((..._a: unknown[]) => {
    child = fakeChild();
    return child;
  }) as unknown as typeof nodeSpawn;

  const engine = createDefaultEngine({
    detect: () => Promise.resolve(detectResult),
    spawnImpl,
    shell: false,
    inactivityMs: 0,
  });

  const cap: Captured = { status: [], deltas: [], done: { called: false } };
  await new Promise<void>((resolve) => {
    engine('热点主题', {
      onStatus: (m) => cap.status.push(m),
      onDelta: (t) => cap.deltas.push(t),
      onDone: (cost) => {
        cap.done = { called: true, cost };
        resolve();
      },
      onError: (m) => {
        cap.error = m;
        resolve();
      },
    });
    // let the async detect resolve + the child spawn, then drive it
    setTimeout(() => {
      if (child) script(child);
    }, 10);
  });
  return cap;
}

const textDelta = (t: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } }) + '\n';
const resultLine = (isError: boolean, cost = 0.05) =>
  JSON.stringify({ type: 'result', subtype: isError ? 'error' : 'success', total_cost_usd: cost, is_error: isError }) + '\n';

describe('createDefaultEngine — terminal status mapping', () => {
  it('streams deltas then done(cost) on a clean exit with a result', async () => {
    const cap = await run(READY, (child) => {
      child.stdout.emit('data', textDelta('初级程序员'));
      child.stdout.emit('data', textDelta('的价值'));
      child.stdout.emit('data', resultLine(false, 0.07));
      child.emit('close', 0, null);
    });
    expect(cap.status).toEqual(['checking agent', 'writing']);
    expect(cap.deltas.join('')).toBe('初级程序员的价值');
    expect(cap.done).toEqual({ called: true, cost: 0.07 });
    expect(cap.error).toBeUndefined();
  });

  it('reports onError (not done) on a non-zero exit with no result', async () => {
    const cap = await run(READY, (child) => {
      child.stderr.emit('data', 'boom: something failed\n');
      child.emit('close', 1, null);
    });
    expect(cap.done.called).toBe(false);
    expect(cap.error).toContain('exited unexpectedly (code 1)');
    expect(cap.error).toContain('boom');
  });

  it('reports onError on a spawn error (no silent done)', async () => {
    const cap = await run(READY, (child) => {
      child.emit('error', new Error('spawn ENOENT'));
    });
    expect(cap.done.called).toBe(false);
    expect(cap.error).toContain('exited unexpectedly');
  });

  it('reports onError when the result line is is_error', async () => {
    const cap = await run(READY, (child) => {
      child.stdout.emit('data', resultLine(true));
      child.emit('close', 0, null);
    });
    expect(cap.done.called).toBe(false);
    expect(cap.error).toBe('the agent reported an error');
  });

  it('surfaces the diagnosis title when the agent is not READY (no spawn)', async () => {
    const cap = await run({ state: 'NOT_INSTALLED' }, () => undefined);
    expect(cap.status).toEqual(['checking agent']);
    expect(cap.done.called).toBe(false);
    expect(cap.error).toContain('not installed');
  });
});
