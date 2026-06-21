// Spawn the local daemon as a child process. In a packaged Electron app, process.execPath is the
// Electron binary, so ELECTRON_RUN_AS_NODE=1 makes it behave as plain Node. The daemon entry,
// exec path, and spawn fn are injectable so the wiring is unit-testable without a real spawn.

import { spawn as nodeSpawn } from 'node:child_process';
import { createRequire } from 'node:module';

export interface DaemonHandle {
  readonly port: number;
  stop: () => void;
}

export interface StartDaemonOptions {
  port?: number;
  host?: string;
  execPath?: string;
  entry?: string;
  spawnImpl?: typeof nodeSpawn;
}

export function startDaemon(opts: StartDaemonOptions = {}): DaemonHandle {
  const port = opts.port ?? 4319;
  const host = opts.host ?? '127.0.0.1';
  const entry = opts.entry ?? createRequire(import.meta.url).resolve('@app/daemon');
  const execPath = opts.execPath ?? process.execPath;
  const spawnImpl = opts.spawnImpl ?? nodeSpawn;

  const child = spawnImpl(execPath, [entry], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(port), HOST: host },
    stdio: 'inherit',
  });

  let stopped = false;
  return {
    port,
    stop() {
      if (stopped) return;
      stopped = true;
      child.kill();
    },
  };
}
