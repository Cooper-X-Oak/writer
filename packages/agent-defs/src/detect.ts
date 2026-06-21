// First-run detection for a RuntimeAgentDef: resolve the bin, probe version, probe auth, and
// classify into a precise diagnosis state. The bin resolver and command runner are injectable so
// this is unit-tested without spawning a real CLI (the daemon wires real implementations in P1-4).

import { execFile } from 'node:child_process';
import type { RuntimeAgentDef } from './types.js';

export type DetectState = 'NOT_INSTALLED' | 'NOT_ON_PATH' | 'TOO_OLD' | 'NOT_LOGGED_IN' | 'READY';

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

const defaultRun: RunFn = (cmd, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      const code = typeof err?.code === 'number' ? err.code : err ? 1 : 0;
      resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });

const NOT_LOGGED_IN = /not logged in|unauthorized|no api key|invalid api key|please run .*login|login required/i;

export async function detectAgent(def: RuntimeAgentDef, deps: DetectDeps = {}): Promise<DetectResult> {
  const run = deps.run ?? defaultRun;
  // Default resolver assumes the bin is on PATH; the daemon injects a real which/where resolver.
  const resolveBin = deps.resolveBin ?? ((bin: string) => bin);

  const resolved = await resolveBin(def.bin, def.fallbackBins ?? []);
  if (!resolved) return { state: 'NOT_INSTALLED', detail: `${def.bin} not found on PATH` };

  const v = await run(resolved, def.versionArgs, def.versionProbeTimeoutMs ?? 5000);
  if (v.code !== 0) {
    return { state: 'NOT_ON_PATH', detail: v.stderr.trim() || 'version probe failed' };
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
