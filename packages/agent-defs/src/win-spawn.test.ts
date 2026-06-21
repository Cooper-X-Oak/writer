import { describe, it, expect } from 'vitest';
import { quoteWinArg, buildWinCmdInvocation } from './win-spawn.js';

describe('quoteWinArg', () => {
  it('leaves a plain token unquoted', () => {
    expect(quoteWinArg('--verbose')).toBe('--verbose');
    expect(quoteWinArg('C:\\nvm4w\\nodejs\\claude.cmd')).toBe('C:\\nvm4w\\nodejs\\claude.cmd');
  });

  it('quotes the empty string', () => {
    expect(quoteWinArg('')).toBe('""');
  });

  it('quotes tokens with spaces', () => {
    expect(quoteWinArg('C:\\Program Files\\nodejs\\claude.cmd')).toBe('"C:\\Program Files\\nodejs\\claude.cmd"');
  });

  it('quotes cmd metacharacters', () => {
    expect(quoteWinArg('a&b')).toBe('"a&b"');
    expect(quoteWinArg('a|b')).toBe('"a|b"');
    expect(quoteWinArg('a>b')).toBe('"a>b"');
    expect(quoteWinArg('a(b)')).toBe('"a(b)"');
  });

  it('doubles embedded double-quotes', () => {
    expect(quoteWinArg('a"b')).toBe('"a""b"');
  });

  it('does NOT trigger on %VAR% / !VAR! (quoting cannot neutralize cmd expansion — best-effort passthrough)', () => {
    // No other metachar → passed through untouched; the doc on quoteWinArg explains why.
    expect(quoteWinArg('%USERNAME%')).toBe('%USERNAME%');
    expect(quoteWinArg('!VAR!')).toBe('!VAR!');
  });
});

describe('buildWinCmdInvocation', () => {
  it('targets cmd.exe with /d /s /c', () => {
    const inv = buildWinCmdInvocation('claude.cmd', ['--version'], 'cmd.exe');
    expect(inv.file).toBe('cmd.exe');
    expect(inv.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
  });

  it('wraps the whole command line in an outer quote pair (sacrificed to cmd /S)', () => {
    const inv = buildWinCmdInvocation('claude.cmd', ['--version'], 'cmd.exe');
    const line = inv.args[3] ?? '';
    expect(line.startsWith('"')).toBe(true);
    expect(line.endsWith('"')).toBe(true);
  });

  it('keeps a spaced bin path individually quoted INSIDE the outer wrap', () => {
    const inv = buildWinCmdInvocation('C:\\Program Files\\nodejs\\claude.cmd', ['-p', '--verbose'], 'cmd.exe');
    // After cmd /S strips the outer pair, the inner per-token quotes must remain so the spaced path
    // is one token, not split on the first space. Outer "…" + inner "bin" → leading "".
    expect(inv.args[3]).toBe('""C:\\Program Files\\nodejs\\claude.cmd" -p --verbose"');
  });

  it('falls back to ComSpec then cmd.exe when no override is given', () => {
    const inv = buildWinCmdInvocation('claude.cmd', []);
    expect(inv.file).toBe(process.env.ComSpec ?? 'cmd.exe');
  });
});
