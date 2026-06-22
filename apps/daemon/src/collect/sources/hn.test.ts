import { describe, it, expect } from 'vitest';
import { mapHnItem, createHnAdapter, HN_ITEM_BASE, HN_LIST_URL } from './hn.js';
import type { AdapterDeps, FetchResponse } from '../types.js';

// Live-verified fixtures (HN API fetched 2026-06-22). The link story + topstories slice are real;
// the Ask-HN item is synthesized to exercise the text/no-url branch.
const LINK_STORY = {
  by: 'T-A',
  descendants: 82,
  id: 48622778,
  kids: [48623127],
  score: 230,
  time: 1782077383,
  title: 'Apertus &#x2013; Open Foundation Model for Sovereign AI',
  type: 'story',
  url: 'https://apertus.ai/',
};
const ASK_STORY = {
  by: 'advisedwang',
  id: 48630000,
  score: 42,
  time: 1782078053,
  title: 'Ask HN: How do you collect writing hotspots?',
  type: 'story',
  text: 'I&#x27;m building a <b>local-first</b> writer and need source provenance.',
  descendants: 7,
};

function resp(json: unknown, status = 200): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    header: () => null,
    text: () => Promise.resolve(JSON.stringify(json)),
    json: () => Promise.resolve(json),
  };
}

describe('mapHnItem', () => {
  const FETCHED = '2026-06-22T00:00:00.000Z';

  it('maps a real link story: url passthrough, title entity-decoded, points/comments, seconds→ms ISO', () => {
    const node = mapHnItem(LINK_STORY, FETCHED);
    expect(node).not.toBeNull();
    expect(node?.url).toBe('https://apertus.ai/');
    expect(node?.title).toBe('Apertus – Open Foundation Model for Sovereign AI');
    expect(node?.points).toBe(230);
    expect(node?.commentCount).toBe(82);
    expect(node?.key).toBe('48622778');
    expect(node?.publishedAt?.startsWith('2026')).toBe(true); // time is SECONDS; *1000 → 2026 not 1970
    expect(node?.fetchedAt).toBe(FETCHED);
  });

  it('maps an Ask-HN story (no url): permalink fallback + HTML-stripped excerpt', () => {
    const node = mapHnItem(ASK_STORY, FETCHED);
    expect(node?.url).toBe('https://news.ycombinator.com/item?id=48630000');
    expect(node?.excerpt).toBe("I'm building a local-first writer and need source provenance.");
    expect(node?.commentCount).toBe(7);
  });

  it('returns null for non-story, dead, or deleted items', () => {
    expect(mapHnItem({ ...LINK_STORY, type: 'comment' }, FETCHED)).toBeNull();
    expect(mapHnItem({ ...LINK_STORY, dead: true }, FETCHED)).toBeNull();
    expect(mapHnItem({ ...LINK_STORY, deleted: true }, FETCHED)).toBeNull();
    expect(mapHnItem(null, FETCHED)).toBeNull();
    expect(mapHnItem({ id: 1, type: 'story' }, FETCHED)).toBeNull(); // missing title
  });

  it('coerces missing descendants→0 and tolerates a missing score', () => {
    const node = mapHnItem({ id: 9, type: 'story', title: 'x', time: 1782077383 }, FETCHED);
    expect(node?.commentCount).toBe(0);
    expect(node?.points).toBeUndefined();
  });
});

function depsFrom(handler: (url: string) => FetchResponse): AdapterDeps {
  return { fetchImpl: (url) => Promise.resolve(handler(url)), now: () => Date.parse('2026-06-22T00:00:00.000Z'), sleep: () => Promise.resolve() };
}

describe('createHnAdapter', () => {
  it('fetches the list once, caps to N ids, fetches items via pool, drops a failed id without sinking the batch', async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => 100 + i); // simulate the live 1000-id list
    const requested = new Set<number>();
    const deps = depsFrom((url) => {
      if (url === HN_LIST_URL) return resp(ids);
      const id = Number(url.slice(HN_ITEM_BASE.length, -'.json'.length));
      requested.add(id);
      if (id === 101) return resp(null, 500); // one bad id → null after retries
      return resp({ id, type: 'story', title: `Story ${String(id)}`, time: 1782077383, score: id, descendants: 1 });
    });
    const nodes = await createHnAdapter().collect(deps);
    expect(requested.size).toBe(30); // HN_DEFAULT_N cap on a 1000-id list (distinct ids)
    expect(nodes).toHaveLength(29); // one id (101) failed and was dropped
    expect(nodes.every((n) => n.sourceType === 'hn')).toBe(true);
  });

  it('respects the n option and clamps it to HN_MAX_N', async () => {
    const ids = Array.from({ length: 80 }, (_, i) => i + 1);
    const requested = new Set<number>();
    const deps = depsFrom((url) => {
      if (url === HN_LIST_URL) return resp(ids);
      const id = Number(url.slice(HN_ITEM_BASE.length, -'.json'.length));
      requested.add(id);
      return resp({ id, type: 'story', title: 't', time: 1782077383 });
    });
    await createHnAdapter({ n: 100 }).collect(deps); // 100 clamped → 50
    expect(requested.size).toBe(50);
  });

  it('returns [] when the list endpoint does not yield an array', async () => {
    const deps = depsFrom(() => resp(null, 500));
    expect(await createHnAdapter().collect(deps)).toEqual([]);
  });
});
