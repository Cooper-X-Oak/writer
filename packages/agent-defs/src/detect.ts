// First-run detection for a RuntimeAgentDef: resolve the bin, probe version, probe auth, and
// classify into a precise diagnosis state. The bin resolver and command runner are injectable so
// this is unit-tested without spawning a real CLI (the daemon wires real implementations in P1-4).

import { execFile } from 'node:child_process';
import type { ExecFileException } from 'node:child_process';
import type { RuntimeAgentDef } from './types.js';
import { buildWinCmdInvocation } from './win-spawn.js';

export type DetectState = 'NOT_INSTALLED' | 'VERSION_PROBE_FAILED' | 'TOO_OLD' | 'NOT_LOGGED_IN' | 'READY';

export interface DetectResult {
  state: DetectState;
  version?: string;
  detail?: string;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type RunFn = (cmd: string, args: string[], timeoutMs: number) => Promise<RunResult>;

export interface DetectDeps {
  /** Resolve a bin (or its fallbacks) to an absolute path, or undefined if not found on PATH. */
  resolveBin?: (bin: string, fallbacks: string[]) => Promise<string | undefined> | string | undefined;
  run?: RunFn;
}

export function parseSemver(s: string): [number, number, number] | undefined {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(s);
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function gte(a: [number, number, number], b: [number, number, number]): boolean {
  const [a0, a1, a2] = a;
  const [b0, b1, b2] = b;
  if (a0 !== b0) return a0 > b0;
  if (a1 !== b1) return a1 > b1;
  return a2 >= b2;
}

// Windows coding-agent CLIs are `.cmd`/`.bat` shims; Node 22+ can't execFile them without a shell
// (EINVAL, CVE-2024-27980). Drive cmd.exe explicitly via buildWinCmdInvocation rather than
// shell:true — shell:true joins [cmd, ...args] with no per-arg quoting, so a spaced bin path
// (C:\Program Files\nodejs\claude.cmd) splits on the first space and probes fail spuriously.
const defaultRun: RunFn = (cmd, args, timeoutMs) =>
  new Promise((resolve) => {
    const done = (err: ExecFileException | null, stdout: string, stderr: string): void => {
      const code = typeof err?.code === 'number' ? err.code : err ? 1 : 0;
      resolve({ code, stdout: stdout || '', stderr: stderr || '' });
    };
    if (process.platform === 'win32') {
      const inv = buildWinCmdInvocation(cmd, args);
      execFile(inv.file, inv.args, { timeout: timeoutMs, windowsVerbatimArguments: true }, done);
    } else {
      execFile(cmd, args, { timeout: timeoutMs }, done);
    }
  });

const WIN_EXECUTABLE = /\.(cmd|exe|bat|com)$/i;

/** From a finder's (possibly multi-line) output, pick the path to spawn. On Windows `where` prints
 *  every match — the bare `sh` shim AND the `.cmd`; prefer a Windows-executable extension since the
 *  extensionless shim can't be spawned. Pure + exported so the selection rule is unit-testable. */
export function pickResolvedPath(lines: string[], isWin: boolean): string | undefined {
  const cleaned = lines.map((s) => s.trim()).filter(Boolean);
  if (isWin) return cleaned.find((l) => WIN_EXECUTABLE.test(l)) ?? cleaned[0];
  return cleaned[0];
}

/** Resolve a bin (or its fallbacks) to an absolute path using `where` (Windows) / `which` (POSIX). */
export async function defaultResolveBin(bin: string, fallbacks: string[] = []): Promise<string | undefined> {
  const isWin = process.platform === 'win32';
  const finder = isWin ? 'where' : 'which';
  for (const candidate of [bin, ...fallbacks]) {
    const hit = await new Promise<string | undefined>((resolve) => {
      execFile(finder, [candidate], { timeout: 5000 }, (err, stdout) => {
        if (err) return resolve(undefined);
        resolve(pickResolvedPath(stdout.split(/\r?\n/), isWin));
      });
    });
    if (hit) return hit;
  }
  return undefined;
}

const NOT_LOGGED_IN = /not logged in|unauthorized|no api key|invalid api key|please run .*login|login required/i;

export async function detectAgent(def: RuntimeAgentDef, deps: DetectDeps = {}): Promise<DetectResult> {
  const run = deps.run ?? defaultRun;
  const resolveBin = deps.resolveBin ?? defaultResolveBin;

  const resolved = await resolveBin(def.bin, def.fallbackBins ?? []);
  if (!resolved) return { state: 'NOT_INSTALLED', detail: `${def.bin} not found on PATH` };

  const v = await run(resolved, def.versionArgs, def.versionProbeTimeoutMs ?? 5000);
  if (v.code !== 0) {
    // Found on PATH but the binary failed to report a version — broken / incompatible install.
    return { state: 'VERSION_PROBE_FAILED', detail: v.stderr.trim() || 'version probe failed' };
  }
  const parsed = parseSemver(v.stdout);
  const version = parsed ? parsed.join('.') : undefined;
  if (def.minVersion && parsed) {
    const min = parseSemver(def.minVersion);
    if (min && !gte(parsed, min)) {
      return { state: 'TOO_OLD', version, detail: `requires >= ${def.minVersion}` };
    }
  }

  if (def.authProbe) {
    const a = await run(resolved, def.authProbe.args, def.authProbe.timeoutMs ?? 5000);
    if (a.code !== 0 || NOT_LOGGED_IN.test(`${a.stdout}\n${a.stderr}`)) {
      return { state: 'NOT_LOGGED_IN', version, detail: 'not authenticated' };
    }
  }

  return { state: 'READY', version };
}
