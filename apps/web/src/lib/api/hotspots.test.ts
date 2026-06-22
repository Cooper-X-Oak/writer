import { describe, it, expect, vi, afterEach } from 'vitest';
import { listHotspots, refreshHotspots } from './hotspots';
import type { Hotspot } from '@app/contracts';

afterEach(() => vi.unstubAllGlobals());

const HOTSPOT: Hotspot = {
  id: 'hn-abc', sourceType: 'hn', title: 'T', url: 'https://x/1', excerpt: '',
  publishedAt: '2026-06-22T00:00:00.000Z', fetchedAt: '2026-06-22T00:00:00.000Z', score: 0.5,
};

describe('listHotspots', () => {
  it('returns body.hotspots', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ hotspots: [HOTSPOT] }) } as unknown as Response));
    expect(await listHotspots()).toEqual([HOTSPOT]);
  });
  it('tolerates a missing hotspots field as []', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response));
    expect(await listHotspots()).toEqual([]);
  });
  it('throws when not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as unknown as Response));
    await expect(listHotspots()).rejects.toThrow(/list hotspots failed: 500/);
  });
});

describe('refreshHotspots', () => {
  it('POSTs application/json and returns the fresh list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ hotspots: [HOTSPOT] }) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    expect(await refreshHotspots()).toEqual([HOTSPOT]);
    const [u, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(u)).toContain('/hotspots/refresh');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
  it('throws when not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as unknown as Response));
    await expect(refreshHotspots()).rejects.toThrow(/refresh hotspots failed: 500/);
  });
});
