import { describe, it, expect } from 'vitest';
import { detectAgent, parseSemver, type RunFn } from './detect.js';
import { claudeCode } from './defs/claude-code.js';

interface Canned {
  code?: number;
  stdout?: string;
  stderr?: string;
}

function runner(map: { version?: Canned; auth?: Canned }): RunFn {
  return async (_cmd, args) => {
    const cfg = args.includes('--version') ? map.version : map.auth;
    return { code: cfg?.code ?? 0, stdout: cfg?.stdout ?? '', stderr: cfg?.stderr ?? '' };
  };
}

describe('parseSemver', () => {
  it('extracts x.y.z and rejects junk', () => {
    expect(parseSemver('2.1.185 (Claude Code)')).toEqual([2, 1, 185]);
    expect(parseSemver('no version here')).toBeUndefined();
  });
});

describe('detectAgent', () => {
  const resolved = (): string => '/usr/bin/claude';

  it('NOT_INSTALLED when the bin does not resolve', async () => {
    const r = await detectAgent(claudeCode, { resolveBin: () => undefined, run: runner({}) });
    expect(r.state).toBe('NOT_INSTALLED');
  });

  it('NOT_ON_PATH when the version probe fails', async () => {
    const r = await detectAgent(claudeCode, {
      resolveBin: resolved,
      run: runner({ version: { code: 127, stderr: 'command not found' } }),
    });
    expect(r.state).toBe('NOT_ON_PATH');
  });

  it('TOO_OLD when below minVersion', async () => {
    const r = await detectAgent(claudeCode, {
      resolveBin: resolved,
      run: runner({ version: { stdout: '1.9.0' } }),
    });
    expect(r).toMatchObject({ state: 'TOO_OLD', version: '1.9.0' });
  });

  it('NOT_LOGGED_IN when the auth probe exits non-zero', async () => {
    const r = await detectAgent(claudeCode, {
      resolveBin: resolved,
      run: runner({ version: { stdout: '2.1.185' }, auth: { code: 1, stderr: 'not logged in' } }),
    });
    expect(r).toMatchObject({ state: 'NOT_LOGGED_IN', version: '2.1.185' });
  });

  it('NOT_LOGGED_IN on auth text even when code is 0', async () => {
    const r = await detectAgent(claudeCode, {
      resolveBin: resolved,
      run: runner({ version: { stdout: '2.1.185' }, auth: { code: 0, stdout: 'Invalid API key' } }),
    });
    expect(r.state).toBe('NOT_LOGGED_IN');
  });

  it('READY when version ok and authenticated', async () => {
    const r = await detectAgent(claudeCode, {
      resolveBin: resolved,
      run: runner({ version: { stdout: '2.1.185' }, auth: { code: 0, stdout: 'Logged in as you' } }),
    });
    expect(r).toMatchObject({ state: 'READY', version: '2.1.185' });
  });

  it('READY for a def without an authProbe', async () => {
    const noAuth = { ...claudeCode, authProbe: undefined };
    const r = await detectAgent(noAuth, { resolveBin: resolved, run: runner({ version: { stdout: '2.0.0' } }) });
    expect(r.state).toBe('READY');
  });

  it('covers the default exec path against a real process (node --version)', async () => {
    // No injected deps → default resolver returns the bin as-is, default runner spawns it.
    const nodeDef = { ...claudeCode, bin: process.execPath, authProbe: undefined };
    const r = await detectAgent(nodeDef);
    expect(r.state).toBe('READY');
    expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
