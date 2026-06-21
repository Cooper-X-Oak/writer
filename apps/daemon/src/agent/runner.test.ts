import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
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
        ctx: {}, // partialMessages omitted → no dedup
        prompt: 'x',
        onEvent: (e) => events.push(e),
        onExit: () => done(),
      });
      setTimeout(() => h.endInput(), 100);
    });
    expect(textOf(events)).toBe('echo:xecho:x'); // stream + message, both kept
  });

  it('abort() kills the child and reports aborted', async () => {
    let exit: AgentExitInfo | undefined;
    await new Promise<void>((done) => {
      const h = startAgentRun({
        def: fakeDef(),
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
});
