import { describe, it, expect, vi } from 'vitest';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import type { spawn as nodeSpawn } from 'node:child_process';
import { startAgentRun, type AgentExitInfo } from './runner.js';
import type { ClaudeStreamEvent } from './stream/claude-jsonl.js';
import type { RuntimeAgentDef } from '@app/agent-defs';

// Integration tests drive the PoC fake CLI (committed fixture) — never the real Claude Code.
// The fixture echoes "echo:<input>" as BOTH streamed deltas and a final message block, and on the
// first turn emits a tool_use + a deliberately malformed line.
const FAKE_CLI = resolve(process.cwd(), 'poc/cli-stream/fake-cli.mjs');

function fakeDef(): RuntimeAgentDef {
  return {
    id: 'fake',
    name: 'Fake CLI',
    bin: process.execPath, // run the fixture with node
    versionArgs: ['--version'],
    streamFormat: 'claude-stream-json',
    promptViaStdin: true,
    promptInputFormat: 'stream-json',
    fallbackModels: [],
    capabilityFlags: { duplicatesTextWithPartialMessages: true },
    buildArgs: () => [FAKE_CLI],
  };
}

const textOf = (events: ClaudeStreamEvent[]): string =>
  events.filter((e): e is Extract<ClaudeStreamEvent, { kind: 'text_delta' }> => e.kind === 'text_delta')
    .map((e) => e.text)
    .join('');

describe('startAgentRun (pipes + fake CLI)', () => {
  it('runs over pipes, parses the stream, and dedups partial text', async () => {
    const events: ClaudeStreamEvent[] = [];
    let exit: AgentExitInfo | undefined;
    await new Promise<void>((done) => {
      const h = startAgentRun({
        def: fakeDef(),
        shell: false, // fixture is node.exe (a real exe); skip the win32 shell wrapper here
        ctx: { partialMessages: true },
        prompt: 'hello',
        onEvent: (e) => events.push(e),
        onExit: (info) => {
          exit = info;
          done();
        },
      });
      expect(h.pid).toBeGreaterThan(0);
      setTimeout(() => h.endInput(), 100);
    });
    expect(exit?.code).toBe(0);
    expect(exit?.aborted).toBe(false);
    expect(textOf(events)).toBe('echo:hello'); // once, not doubled
    expect(events.some((e) => e.kind === 'tool_use')).toBe(true);
    expect(events.some((e) => e.kind === 'tool_result')).toBe(true);
    expect(events.some((e) => e.kind === 'result')).toBe(true);
    // the fixture's malformed line surfaces as an error event, not a crash
    expect(events.some((e) => e.kind === 'error')).toBe(true);
  });

  it('keeps stdin open for mid-session injection (two turns)', async () => {
    const events: ClaudeStreamEvent[] = [];
    let results = 0;
    await new Promise<void>((done) => {
      const h = startAgentRun({
        def: fakeDef(),
        shell: false, // fixture is node.exe (a real exe); skip the win32 shell wrapper here
        ctx: { partialMessages: true },
        prompt: 'one',
        onEvent: (e) => {
          events.push(e);
          if (e.kind === 'result') {
            results += 1;
            if (results === 1) h.sendUserMessage('two');
            else h.endInput();
          }
        },
        onExit: () => done(),
      });
    });
    expect(results).toBe(2);
    expect(textOf(events)).toBe('echo:oneecho:two');
  });

  it('passes both text sources through when dedup is off (negative control)', async () => {
    const events: ClaudeStreamEvent[] = [];
    await new Promise<void>((done) => {
      const h = startAgentRun({
        def: fakeDef(),
        shell: false, // fixture is node.exe (a real exe); skip the win32 shell wrapper here
        ctx: {}, // partialMessages omitted → no dedup
        prompt: 'x',
        onEvent: (e) => events.push(e),
        onExit: () => done(),
      });
      setTimeout(() => h.endInput(), 100);
    });
    expect(textOf(events)).toBe('echo:xecho:x'); // stream + message, both kept
  });

  // A fake child for the failure/timeout paths, which the real fixture can't trigger on demand.
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
    // stdin is an EventEmitter too so the runner can attach an 'error' listener (EPIPE race guard).
    child.stdin = Object.assign(new EventEmitter(), {
      writable: true,
      write: () => undefined,
      end: () => undefined,
    });
    child.kill = () => {
      child.emit('close', null, 'SIGTERM');
      return true;
    };
    return child;
  }

  it('surfaces a spawn error as a terminal exit instead of crashing', () => {
    const child = fakeChild();
    const spawnImpl = (() => child) as unknown as typeof nodeSpawn;
    let stderr = '';
    let exit: AgentExitInfo | undefined;
    startAgentRun({
      def: fakeDef(),
      shell: false,
      ctx: {},
      prompt: 'x',
      spawnImpl,
      onEvent: () => {},
      onStderr: (c) => (stderr += c),
      onExit: (info) => (exit = info),
    });
    child.emit('error', new Error('spawn ENOENT'));
    expect(stderr).toContain('spawn error:');
    expect(exit).toEqual({ code: null, signal: null, aborted: false });
  });

  it('reaps a silent child via the inactivity timeout', async () => {
    const child = fakeChild();
    const spawnImpl = (() => child) as unknown as typeof nodeSpawn;
    let stderr = '';
    const exit = await new Promise<AgentExitInfo | undefined>((done) => {
      startAgentRun({
        def: fakeDef(),
        shell: false,
        inactivityMs: 40,
        ctx: {},
        prompt: 'x',
        spawnImpl,
        onEvent: () => {},
        onStderr: (c) => (stderr += c),
        onExit: (info) => done(info),
      });
    });
    expect(stderr).toContain('inactivity timeout');
    expect(exit?.aborted).toBe(false);
  });

  it('abort() kills the child and reports aborted', async () => {
    let exit: AgentExitInfo | undefined;
    await new Promise<void>((done) => {
      const h = startAgentRun({
        def: fakeDef(),
        shell: false, // fixture is node.exe (a real exe); skip the win32 shell wrapper here
        ctx: {},
        prompt: 'hang',
        onEvent: () => {},
        onExit: (info) => {
          exit = info;
          done();
        },
      });
      setTimeout(() => h.abort(), 100);
    });
    expect(exit?.aborted).toBe(true);
    expect(exit?.signal === 'SIGTERM' || exit?.code !== 0).toBe(true);
  });

  it('does not crash when child.stdin emits error (EPIPE race surfaces as stderr)', () => {
    const child = fakeChild();
    const spawnImpl = (() => child) as unknown as typeof nodeSpawn;
    let stderr = '';
    startAgentRun({
      def: fakeDef(),
      shell: false,
      ctx: {},
      prompt: 'x',
      spawnImpl,
      onEvent: () => {},
      onStderr: (c) => (stderr += c),
    });
    // An unhandled 'error' on the stdin Writable would crash the daemon; the listener must catch it.
    expect(() => child.stdin.emit('error', new Error('write EPIPE'))).not.toThrow();
    expect(stderr).toContain('stdin error:');
  });

  it('resets the inactivity window on sendUserMessage (no reap during a mid-session pause)', () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const spawnImpl = (() => child) as unknown as typeof nodeSpawn;
      let stderr = '';
      const h = startAgentRun({
        def: fakeDef(),
        shell: false,
        inactivityMs: 1000,
        ctx: {},
        prompt: 'one',
        spawnImpl,
        onEvent: () => {},
        onStderr: (c) => (stderr += c),
      });
      vi.advanceTimersByTime(900); // initial prompt armed at t=0 → would fire at t=1000
      h.sendUserMessage('two'); // fresh input at t=900 must re-arm → next fire at t=1900
      vi.advanceTimersByTime(900); // t=1800, still before the re-armed deadline
      expect(stderr).not.toContain('inactivity timeout');
      vi.advanceTimersByTime(200); // t=2000, past the re-armed deadline
      expect(stderr).toContain('inactivity timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('abort() cancels the inactivity watchdog (no late misleading timeout line)', () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const spawnImpl = (() => child) as unknown as typeof nodeSpawn;
      let stderr = '';
      const h = startAgentRun({
        def: fakeDef(),
        shell: false,
        inactivityMs: 1000,
        ctx: {},
        prompt: 'x',
        spawnImpl,
        onEvent: () => {},
        onStderr: (c) => (stderr += c),
      });
      vi.advanceTimersByTime(500);
      h.abort(); // killTree() must clearIdle() so the watchdog can't fire after cancel
      vi.advanceTimersByTime(2000);
      expect(stderr).not.toContain('inactivity timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  // The win32 cmd.exe branch (shell:true) is otherwise unexercised — every other test forces
  // shell:false. Verify the command line carries the outer quote wrap that `cmd /S` strips, so a
  // spaced bin path survives. Gated to win32 since the branch is platform-conditional.
  const winIt = process.platform === 'win32' ? it : it.skip;
  winIt('win32 shell: wraps the cmd.exe command line so a spaced bin path survives /S', () => {
    let captured: { file: string; args: readonly string[] } | undefined;
    const child = fakeChild();
    const spawnImpl = ((file: string, args: readonly string[]) => {
      captured = { file, args };
      return child;
    }) as unknown as typeof nodeSpawn;
    const def: RuntimeAgentDef = {
      ...fakeDef(),
      bin: 'C:\\Program Files\\nodejs\\claude.cmd',
      buildArgs: () => ['-p', '--verbose'],
    };
    startAgentRun({ def, shell: true, ctx: {}, prompt: 'x', spawnImpl, onEvent: () => {} });
    expect(captured?.file.toLowerCase()).toContain('cmd');
    const line = String(captured?.args[captured.args.length - 1] ?? '');
    expect(line.startsWith('"')).toBe(true); // outer wrap present
    expect(line.endsWith('"')).toBe(true);
    expect(line).toContain('"C:\\Program Files\\nodejs\\claude.cmd"'); // bin individually quoted inside
  });
});
