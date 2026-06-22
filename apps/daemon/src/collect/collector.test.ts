import { describe, it, expect } from 'vitest';
import { collectHotspots, nodeToHotspot, hotspotId } from './collector.js';
import type { ProvenanceNode, SourceAdapter, AdapterDeps, CollectConfig } from './types.js';
import type { SourceType } from '@app/contracts';

const NOW = Date.parse('2026-06-22T00:00:00.000Z');
const HOUR = 3_600_000;
const iso = (h: number) => new Date(NOW - h * HOUR).toISOString();

function node(over: Partial<ProvenanceNode> = {}): ProvenanceNode {
  return {
    sourceType: 'hn',
    title: 't',
    url: 'https://x/1',
    excerpt: '',
    publishedAt: iso(1),
    fetchedAt: iso(0),
    key: 'k',
    ...over,
  };
}

function adapter(sourceType: SourceType, nodes: ProvenanceNode[]): SourceAdapter {
  return { id: sourceType, sourceType, collect: () => Promise.resolve(nodes) };
}
function throwingAdapter(sourceType: SourceType): SourceAdapter {
  return { id: sourceType, sourceType, collect: () => Promise.reject(new Error('source down')) };
}

const deps: AdapterDeps = { fetchImpl: () => Promise.reject(new Error('unused')), now: () => NOW };

function cfg(sources: SourceAdapter[], over: Partial<CollectConfig> = {}): CollectConfig {
  return { sources, sourceWeights: { hn: 1, rss: 0.8 }, topN: 20, perSourceCap: 10, ...over };
}

describe('hotspotId', () => {
  it('is deterministic and stable for the same (sourceType, key)', () => {
    expect(hotspotId('hn', '123')).toBe(hotspotId('hn', '123'));
    expect(hotspotId('hn', '123')).not.toBe(hotspotId('rss', '123'));
    expect(hotspotId('hn', '../etc')).toMatch(/^hn-[0-9a-f]{16}$/); // path-unsafe key → safe hashed id
  });
});

describe('nodeToHotspot', () => {
  it('builds a fresh immutable Hotspot, never an empty url, with optional fields conditional', () => {
    const n = node({ sourceType: 'hn', points: 10, commentCount: 5, author: 'a', url: 'https://x/9', key: '9' });
    const h = nodeToHotspot(n, 0.42);
    expect(h.url).toBe('https://x/9');
    expect(h.points).toBe(10);
    expect(h.score).toBe(0.42);
    expect(h.id).toBe(hotspotId('hn', '9'));
    // mutating the hotspot does not touch the source node
    h.title = 'changed';
    expect(n.title).toBe('t');
  });
  it('omits optional fields that are absent on the node', () => {
    const h = nodeToHotspot(node({ sourceType: 'rss', key: 'r' }), 0.1);
    expect('points' in h).toBe(false);
    expect('author' in h).toBe(false);
  });
});

describe('collectHotspots', () => {
  it('runs all adapters, flattens, scores, caps, mints ids, and sets collectedAt from injected now', async () => {
    const hn = adapter('hn', [node({ key: 'h1', points: 100, commentCount: 50 }), node({ key: 'h2', points: 1 })]);
    const rss = adapter('rss', [node({ sourceType: 'rss', key: 'r1' })]);
    const snap = await collectHotspots(cfg([hn, rss]), deps);
    expect(snap.collectedAt).toBe(new Date(NOW).toISOString());
    expect(snap.hotspots).toHaveLength(3);
    expect(new Set(snap.hotspots.map((h) => h.id)).size).toBe(3); // distinct deterministic ids
  });

  it('does NOT let one dead source sink the run (allSettled best-effort)', async () => {
    const snap = await collectHotspots(cfg([throwingAdapter('hn'), adapter('rss', [node({ sourceType: 'rss', key: 'r1' })])]), deps);
    expect(snap.hotspots.map((h) => h.sourceType)).toEqual(['rss']);
  });

  it('returns hotspots sorted by score desc', async () => {
    const hot = node({ key: 'hot', points: 500, commentCount: 300, publishedAt: iso(1) });
    const cold = node({ key: 'cold', points: 0, commentCount: 0, publishedAt: iso(72) });
    const snap = await collectHotspots(cfg([adapter('hn', [cold, hot])]), deps);
    expect(snap.hotspots.map((h) => h.id)).toEqual([hotspotId('hn', 'hot'), hotspotId('hn', 'cold')]);
    expect(snap.hotspots[0]!.score).toBeGreaterThan(snap.hotspots[1]!.score);
  });

  it('applies the topN budget cap', async () => {
    const nodes = Array.from({ length: 10 }, (_, i) => node({ key: `h${String(i)}`, points: i }));
    const snap = await collectHotspots(cfg([adapter('hn', nodes)], { topN: 3, perSourceCap: 10 }), deps);
    expect(snap.hotspots).toHaveLength(3);
  });
});
