import { describe, it, expect, vi, afterEach } from 'vitest';
import { boundedText, realFetch, createRefresh } from './refresh.js';
import type { CollectConfig, ProvenanceNode, SourceAdapter } from './types.js';
import type { HotspotSnapshot } from '@app/contracts';
import type { HotspotStore } from './store.js';

afterEach(() => vi.unstubAllGlobals());

describe('boundedText', () => {
  it('returns the full body when under the cap', async () => {
    expect(await boundedText(new Response('hello world'), 1000)).toBe('hello world');
  });
  it('throws once the running total exceeds the cap (absent/lying Content-Length backstop)', async () => {
    await expect(boundedText(new Response('x'.repeat(5000)), 100)).rejects.toThrow(/cap/);
  });
});

describe('realFetch', () => {
  it('maps a real Response onto FetchResponse (ok/status/header/json)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ a: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }))),
    );
    const res = await realFetch()('https://api.com/x');
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.header('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ a: 1 });
  });
  it('text() throws when the streamed body exceeds the cap', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('y'.repeat(2000)))));
    const res = await realFetch(100)('https://big.com/feed');
    await expect(res.text()).rejects.toThrow(/cap/);
  });
});

describe('createRefresh', () => {
  function node(over: Partial<ProvenanceNode> = {}): ProvenanceNode {
    return {
      sourceType: 'hn', title: 't', url: 'https://x/1', excerpt: '',
      publishedAt: '2026-06-22T00:00:00.000Z', fetchedAt: '2026-06-22T00:00:00.000Z', key: 'k', ...over,
    };
  }
  const adapter = (nodes: ProvenanceNode[]): SourceAdapter => ({ id: 'hn', sourceType: 'hn', collect: () => Promise.resolve(nodes) });

  it('collects via injected fetch+now, persists via injected store, returns the snapshot', async () => {
    const config: CollectConfig = { sources: [adapter([node({ key: 'a' })])], sourceWeights: { hn: 1, rss: 0.8 }, topN: 20, perSourceCap: 10 };
    let saved: HotspotSnapshot | undefined;
    const store: HotspotStore = { read: () => Promise.resolve(undefined), save: (s) => { saved = s; return Promise.resolve(); } };
    const refresh = createRefresh({ config, store, fetchImpl: () => Promise.reject(new Error('unused')), now: () => Date.parse('2026-06-22T00:00:00.000Z') });

    const snap = await refresh();
    expect(snap.hotspots).toHaveLength(1);
    expect(snap.collectedAt).toBe('2026-06-22T00:00:00.000Z');
    expect(saved).toBe(snap); // persisted exactly what it returned
  });
});
