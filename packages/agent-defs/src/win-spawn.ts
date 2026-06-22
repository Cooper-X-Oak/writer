// Build a cmd.exe invocation for a Windows `.cmd`/`.bat` shim that Node 22+ refuses to spawn
// directly (EINVAL, CVE-2024-27980). Drive cmd.exe ourselves with verbatim args so Node does not
// re-quote, and quote each token so spaces and metacharacters survive.

/** Quote one token for a cmd.exe command line. cmd treats `& | < > ( ) ^` as metacharacters OUTSIDE
 *  double quotes and splits on spaces; wrapping such a token in quotes (doubling embedded quotes)
 *  neutralizes them. NOTE: `%VAR%` (always) and `!VAR!` (when delayed expansion is enabled) are
 *  expanded by cmd even INSIDE double quotes, so they cannot be neutralized by quoting — they are
 *  not in the trigger set and are passed through best-effort. Real call sites (resolved bin paths,
 *  flag values) do not contain them. */
export function quoteWinArg(s: string): string {
  if (s === '') return '""';
  if (!/[\s"&|<>()^]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export interface WinCmdInvocation {
  /** Executable to spawn — cmd.exe (ComSpec). */
  file: string;
  /** argv for cmd.exe; pass with `windowsVerbatimArguments: true`. */
  args: string[];
}

/** Build `cmd.exe /d /s /c "<quoted command line>"`. The OUTER quote pair is mandatory: `cmd /S`
 *  always strips the command line's leading and trailing quote, so without an outer wrap to
 *  sacrifice, a quoted bin path (e.g. `C:\Program Files\nodejs\claude.cmd`) loses its quotes and cmd
 *  splits it on the first space. This mirrors Node's own internal `shell: true` Windows path. */
export function buildWinCmdInvocation(bin: string, args: readonly string[], comSpec?: string): WinCmdInvocation {
  const line = [bin, ...args].map(quoteWinArg).join(' ');
  return {
    file: comSpec ?? process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
  };
}
