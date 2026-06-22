import { describe, it, expect, vi, afterEach } from 'vitest';
import { listFeeds, addFeed, removeFeed } from './feeds';

afterEach(() => vi.unstubAllGlobals());

const okFeeds = (feeds: string[]) =>
  vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ feeds }) } as unknown as Response);

describe('listFeeds', () => {
  it('returns body.feeds (or [] when absent)', async () => {
    vi.stubGlobal('fetch', okFeeds(['https://a.com/f']));
    expect(await listFeeds()).toEqual(['https://a.com/f']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response));
    expect(await listFeeds()).toEqual([]);
  });
  it('throws when not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as unknown as Response));
    await expect(listFeeds()).rejects.toThrow(/list feeds failed: 500/);
  });
});

describe('addFeed / removeFeed', () => {
  it('POSTs/DELETEs the url as a JSON body and returns the new list', async () => {
    const post = okFeeds(['https://a.com/f']);
    vi.stubGlobal('fetch', post);
    expect(await addFeed('https://a.com/f')).toEqual(['https://a.com/f']);
    let [u, init] = post.mock.calls[0] as [string, RequestInit];
    expect(String(u)).toContain('/api/feeds');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://a.com/f' });

    const del = okFeeds([]);
    vi.stubGlobal('fetch', del);
    expect(await removeFeed('https://a.com/f')).toEqual([]);
    [u, init] = del.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://a.com/f' });
  });
  it('throws on non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 } as unknown as Response));
    await expect(addFeed('x')).rejects.toThrow(/add feed failed: 400/);
    await expect(removeFeed('x')).rejects.toThrow(/remove feed failed: 400/);
  });
});
