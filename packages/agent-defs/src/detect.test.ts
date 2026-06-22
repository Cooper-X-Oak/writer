import { describe, it, expect } from 'vitest';
import { detectAgent, parseSemver, defaultResolveBin, pickResolvedPath, type RunFn } from './detect.js';
import { claudeCode } from './defs/claude-code.js';

describe('pickResolvedPath', () => {
  it('prefers a Windows-executable extension over the bare sh shim', () => {
    // shape of a typical `where claude` on Windows: the bare sh shim plus a .cmd executable
    const lines = ['C:\\tools\\nodejs\\claude', 'C:\\tools\\nodejs\\claude.cmd'];
    expect(pickResolvedPath(lines, true)).toBe('C:\\tools\\nodejs\\claude.cmd');
  });

  it('falls back to the first line when no win-executable extension is present', () => {
    expect(pickResolvedPath(['C:\\x\\claude'], true)).toBe('C:\\x\\claude');
  });

  it('returns the first non-empty line on POSIX, trimming blanks', () => {
    expect(pickResolvedPath(['', '  /usr/local/bin/claude  ', ''], false)).toBe('/usr/local/bin/claude');
  });

  it('returns undefined when there is nothing to pick', () => {
    expect(pickResolvedPath([''], true)).toBeUndefined();
  });
});

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

  it('VERSION_PROBE_FAILED when the binary is found but --version fails', async () => {
    const r = await detectAgent(claudeCode, {
      resolveBin: resolved,
      run: runner({ version: { code: 1, stderr: 'segfault' } }),
    });
    expect(r.state).toBe('VERSION_PROBE_FAILED');
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

  it('covers the default runner against a real process (node --version)', async () => {
    // Inject only the resolver; the default runner spawns node --version for real.
    const nodeDef = { ...claudeCode, bin: process.execPath, authProbe: undefined };
    const r = await detectAgent(nodeDef, { resolveBin: () => process.execPath });
    expect(r.state).toBe('READY');
    expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('NOT_INSTALLED through the real which/where resolver for a bogus bin', async () => {
    const r = await detectAgent({ ...claudeCode, bin: 'definitely-not-a-real-bin-xyz', fallbackBins: [] });
    expect(r.state).toBe('NOT_INSTALLED');
  });
});

describe('defaultResolveBin', () => {
  it('resolves a binary that is on PATH (node)', async () => {
    expect(await defaultResolveBin('node')).toBeTruthy();
  });

  it('returns undefined for a nonexistent binary', async () => {
    expect(await defaultResolveBin('definitely-not-a-real-bin-xyz')).toBeUndefined();
  });

  it('falls back to the next candidate', async () => {
    expect(await defaultResolveBin('definitely-not-a-real-bin-xyz', ['node'])).toBeTruthy();
  });
});
