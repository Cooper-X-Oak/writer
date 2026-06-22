import { describe, it, expect, vi, afterEach } from 'vitest';
import { rewrite } from './rewrite';

afterEach(() => vi.unstubAllGlobals());

describe('rewrite', () => {
  it('POSTs blockText + instruction and returns the text', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ text: '改写后' }) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    expect(await rewrite('原文', '更短')).toBe('改写后');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ blockText: '原文', instruction: '更短' });
  });

  it('surfaces the server error message when not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.resolve({ error: 'the agent exited unexpectedly' }),
      } as unknown as Response),
    );
    await expect(rewrite('x', '')).rejects.toThrow(/agent exited unexpectedly/);
  });
});
