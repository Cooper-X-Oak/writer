import { describe, it, expect } from 'vitest';
import { score, selectTopHotspots } from './score.js';
import type { ProvenanceNode, ScoreOpts } from './types.js';

const NOW = Date.parse('2026-06-22T00:00:00.000Z');
const HOUR = 3_600_000;
const iso = (hoursAgo: number): string => new Date(NOW - hoursAgo * HOUR).toISOString();

function node(over: Partial<ProvenanceNode> = {}): ProvenanceNode {
  return {
    sourceType: 'hn',
    title: 't',
    url: 'https://x/1',
    excerpt: '',
    publishedAt: iso(2),
    fetchedAt: iso(0),
    key: 'k',
    ...over,
  };
}

const baseOpts: ScoreOpts = { now: NOW, sourceWeights: { hn: 1.0, rss: 0.8 } };

describe('score', () => {
  it('recency dominates between otherwise-identical posts', () => {
    const fresh = node({ publishedAt: iso(1), key: 'fresh' });
    const old = node({ publishedAt: iso(48), key: 'old' });
    expect(score(fresh, baseOpts)).toBeGreaterThan(score(old, baseOpts));
  });

  it('source weight SCALES quality, it does not blindly gate: a rich RSS beats a dead HN', () => {
    const deadHn = node({ sourceType: 'hn', points: 0, commentCount: 0, publishedAt: iso(2) });
    const richRss = node({ sourceType: 'rss', publishedAt: iso(2), key: 'r' });
    expect(score(richRss, baseOpts)).toBeGreaterThan(score(deadHn, baseOpts));
  });

  it('engagement separates two equally-fresh HN posts', () => {
    const hot = node({ points: 500, commentCount: 300, publishedAt: iso(3), key: 'hot' });
    const quiet = node({ points: 2, commentCount: 0, publishedAt: iso(3), key: 'quiet' });
    expect(score(hot, baseOpts)).toBeGreaterThan(score(quiet, baseOpts));
  });

  it('keyword boost flips order vs pure recency; omitting keywords restores recency order', () => {
    const onTopic = node({ title: 'Rust + WASM perf', points: 10, commentCount: 5, publishedAt: iso(3), key: 'on' });
    const offTopic = node({ title: 'Cooking pasta', points: 10, commentCount: 5, publishedAt: iso(1), key: 'off' });

    const withKw: ScoreOpts = { ...baseOpts, keywords: ['rust', 'wasm'] };
    expect(score(onTopic, withKw)).toBeGreaterThan(score(offTopic, withKw));

    // Without keywords the fresher off-topic post ranks higher — proving the boost changed the order.
    expect(score(offTopic, baseOpts)).toBeGreaterThan(score(onTopic, baseOpts));
  });

  it('keyword match is case-insensitive', () => {
    const n = node({ title: 'RUST release', publishedAt: iso(5) });
    const hit: ScoreOpts = { ...baseOpts, keywords: ['rust'] };
    const miss: ScoreOpts = { ...baseOpts, keywords: ['python'] };
    expect(score(n, hit)).toBeGreaterThan(score(n, miss));
  });

  it('unknown sourceType weight → score 0 (excluded)', () => {
    const opts: ScoreOpts = { now: NOW, sourceWeights: { hn: 0, rss: 0.8 } };
    expect(score(node({ sourceType: 'hn' }), opts)).toBe(0);
  });

  it('null/unparseable publishedAt → NEUTRAL recency (not buried as "oldest"), never NaN', () => {
    const bad = score(node({ sourceType: 'rss', publishedAt: 'not-a-date', key: 'bad' }), baseOpts);
    const nul = score(node({ sourceType: 'rss', publishedAt: null, key: 'nul' }), baseOpts);
    expect(Number.isNaN(bad)).toBe(false);
    expect(Number.isNaN(nul)).toBe(false);
    expect(bad).toBe(nul); // both treated identically (neutral recency)
    // A fresh item still beats an undated one, but an undated item beats a genuinely OLD dated one —
    // proving "missing date → neutral", not "missing date → oldest".
    const fresh = score(node({ sourceType: 'rss', publishedAt: iso(1), key: 'fresh' }), baseOpts);
    const old = score(node({ sourceType: 'rss', publishedAt: iso(120), key: 'old' }), baseOpts);
    expect(fresh).toBeGreaterThan(nul);
    expect(nul).toBeGreaterThan(old);
  });

  it('a future/skewed publishedAt clamps recency to 1.0 (does not exceed a now-dated post)', () => {
    const future = score(node({ points: 0, commentCount: 0, publishedAt: iso(-5) }), baseOpts);
    const justNow = score(node({ points: 0, commentCount: 0, publishedAt: iso(0) }), baseOpts);
    expect(future).toBeCloseTo(justNow, 10);
  });

  it('negative points/comments are coerced to 0 (no negative engagement)', () => {
    const neg = node({ points: -100, commentCount: -5, publishedAt: iso(2) });
    const zero = node({ points: 0, commentCount: 0, publishedAt: iso(2) });
    expect(score(neg, baseOpts)).toBeCloseTo(score(zero, baseOpts), 10);
  });
});

describe('selectTopHotspots', () => {
  it('does NOT mutate the input array and is deterministic across runs', () => {
    const input = [node({ key: 'a', publishedAt: iso(1) }), node({ key: 'b', publishedAt: iso(2) })];
    const snapshot = [...input];
    const r1 = selectTopHotspots(input, baseOpts);
    const r2 = selectTopHotspots(input, baseOpts);
    expect(input).toEqual(snapshot); // input untouched
    expect(r1.map((e) => e.node.key)).toEqual(r2.map((e) => e.node.key)); // identical ordering
  });

  it('breaks ties deterministically: equal score → equal publishedAt → key asc', () => {
    // identical fields so score + publishedAt tie; only key distinguishes.
    const z = node({ key: 'z', publishedAt: iso(2), points: 1, commentCount: 1 });
    const a = node({ key: 'a', publishedAt: iso(2), points: 1, commentCount: 1 });
    const out = selectTopHotspots([z, a], baseOpts);
    expect(out.map((e) => e.node.key)).toEqual(['a', 'z']);
  });

  it('perSourceCap limits one source and topN caps the total', () => {
    const nodes = [
      ...Array.from({ length: 5 }, (_, i) => node({ sourceType: 'hn', key: `h${i}`, points: 100, publishedAt: iso(1) })),
      ...Array.from({ length: 5 }, (_, i) => node({ sourceType: 'rss', key: `r${i}`, publishedAt: iso(1) })),
    ];
    const out = selectTopHotspots(nodes, baseOpts, { topN: 6, perSourceCap: 2 });
    expect(out.length).toBe(4); // 2 hn + 2 rss, capped per-source before topN
    expect(out.filter((e) => e.node.sourceType === 'hn').length).toBe(2);
    expect(out.filter((e) => e.node.sourceType === 'rss').length).toBe(2);
  });

  it('excludes zero-score (unknown-source) nodes', () => {
    const opts: ScoreOpts = { now: NOW, sourceWeights: { hn: 1, rss: 0 } };
    const out = selectTopHotspots([node({ sourceType: 'rss', key: 'r' }), node({ sourceType: 'hn', key: 'h' })], opts);
    expect(out.map((e) => e.node.key)).toEqual(['h']);
  });
});
