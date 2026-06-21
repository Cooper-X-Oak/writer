import { describe, it, expect } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { startDaemon } from './daemon-process.js';

describe('startDaemon', () => {
  it('spawns the daemon entry in node mode and stops it idempotently', () => {
    const kills: string[] = [];
    const fakeChild = { kill: () => (kills.push('kill'), true) } as unknown as ChildProcess;
    let captured: { cmd: string; args: readonly string[]; env: NodeJS.ProcessEnv } | undefined;

    const spawnImpl = ((cmd: string, args: readonly string[], options: { env: NodeJS.ProcessEnv }) => {
      captured = { cmd, args, env: options.env };
      return fakeChild;
    }) as unknown as typeof import('node:child_process').spawn;

    const handle = startDaemon({
      port: 5005,
      entry: '/abs/daemon/dist/index.js',
      execPath: '/bin/node',
      spawnImpl,
    });

    expect(handle.port).toBe(5005);
    expect(captured?.cmd).toBe('/bin/node');
    expect(captured?.args).toEqual(['/abs/daemon/dist/index.js']);
    expect(captured?.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(captured?.env.PORT).toBe('5005');
    expect(captured?.env.HOST).toBe('127.0.0.1');

    handle.stop();
    handle.stop(); // idempotent
    expect(kills).toHaveLength(1);
  });
});
