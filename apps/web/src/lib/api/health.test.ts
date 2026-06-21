import { describe, it, expect, vi, afterEach } from 'vitest';
import { getHealth } from './health';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getHealth', () => {
  it('parses the Health DTO from the daemon', async () => {
    const body = { status: 'ok', version: '1.2.3', uptimeMs: 42 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
    await expect(getHealth()).resolves.toEqual(body);
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    await expect(getHealth()).rejects.toThrow(/500/);
  });
});
