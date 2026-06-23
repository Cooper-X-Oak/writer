import { describe, it, expect } from 'vitest';
import type { Hotspot, MaterialCard } from '@app/contracts';
import {
  tokenize,
  seedFromHotspot,
  seedFromCard,
  seedFromQuery,
  existingFromCards,
  gatherCandidates,
  ruleLabel,
  runInquiry,
  MAX_INQUIRY,
  PER_HOST_CAP,
  type AgentClassifier,
  type ExistingCorpus,
} from './inquiry.js';

const fixedNow = () => new Date('2026-06-22T00:00:00.000Z');
const deps = { now: fixedNow, genId: () => 'gen' };

function hs(over: Partial<Hotspot> = {}): Hotspot {
  return {
    id: over.id ?? 'h1',
    sourceType: over.sourceType ?? 'hn',
    title: over.title ?? 'Rust async runtime benchmarks',
    url: over.url ?? 'https://example.com/a',
    excerpt: over.excerpt ?? '',
    publishedAt: over.publishedAt ?? null,
    fetchedAt: over.fetchedAt ?? '2026-06-22T00:00:00.000Z',
    score: over.score ?? 0.5,
    ...(over.author ? { author: over.author } : {}),
    ...(over.points !== undefined ? { points: over.points } : {}),
    ...(over.commentCount !== undefined ? { commentCount: over.commentCount } : {}),
  };
}

const empty: ExistingCorpus = { ids: new Set(), urls: new Set() };

describe('tokenize', () => {
  it('lowercases, drops stopwords and short tokens, dedups', () => {
    const t = tokenize('The Rust Rust async AND a runtime');
    expect(t).toContain('rust');
    expect(t).toContain('async');
    expect(t).toContain('runtime');
    expect(t).not.toContain('the');
    expect(t).not.toContain('and');
    expect(t.filter((x) => x === 'rust')).toHaveLength(1); // deduped
  });

  it('keeps CJK runs of length >= 2', () => {
    const t = tokenize('国产大模型 的 评测');
    expect(t).toContain('国产大模型');
    expect(t).toContain('评测');
  });

  it('caps the query length before tokenizing (bounds work on untrusted input)', () => {
    const seed = seedFromQuery(`${'rust '.repeat(500)}tail`);
    expect(seed?.thesis.length).toBeLessThanOrEqual(200);
    expect(seed?.keywords).toContain('rust');
    expect(seed?.keywords).not.toContain('tail'); // past the 200-char slice
  });
});

describe('seed builders', () => {
  it('seedFromHotspot carries id, url, host (www-stripped), keywords', () => {
    const seed = seedFromHotspot(hs({ id: 'h9', url: 'https://www.example.com/x', title: 'WebGPU shaders' }));
    expect(seed.id).toBe('h9');
    expect(seed.url).toBe('https://www.example.com/x');
    expect(seed.host).toBe('example.com');
    expect(seed.keywords).toContain('webgpu');
  });

  it('seedFromCard uses link content + source title; undefined for empty', () => {
    const card: MaterialCard = {
      id: 'c1', kind: 'link', origin: 'manual', klass: '原始', confidence: 1, tags: [], note: '',
      addedAt: '2026-06-22T00:00:00.000Z',
      content: { url: 'https://blog.test/post', excerpt: 'a deep dive on vector databases', title: 'Vectors' },
    };
    const seed = seedFromCard(card);
    expect(seed?.id).toBe('c1');
    expect(seed?.host).toBe('blog.test');
    expect(seed?.keywords).toContain('vector');
  });

  it('seedFromQuery has empty id (no back-link) and tokenized keywords', () => {
    const seed = seedFromQuery('  edge inference latency  ');
    expect(seed?.id).toBe('');
    expect(seed?.keywords).toContain('inference');
    expect(seedFromQuery('   ')).toBeUndefined();
  });
});

describe('existingFromCards', () => {
  it('collects ids and normalized urls (link content + non-link source.url)', () => {
    const cards: MaterialCard[] = [
      { id: 'hs_a', kind: 'link', origin: 'auto', klass: '原始', confidence: 1, tags: [], note: '',
        addedAt: '2026-06-22T00:00:00.000Z', content: { url: 'https://e.com/a/', excerpt: '' } },
    ];
    const ex = existingFromCards(cards);
    expect(ex.ids.has('hs_a')).toBe(true);
    expect(ex.urls.has('https://e.com/a')).toBe(true); // trailing slash normalized off
  });
});

describe('gatherCandidates', () => {
  const seed = seedFromHotspot(hs({ id: 'seed', title: 'Rust async runtime', url: 'https://seed.com/x' }));

  it('keeps only keyword-overlapping candidates and excludes the seed itself', () => {
    const pool = [
      hs({ id: 'seed', url: 'https://seed.com/x' }),
      hs({ id: 'm1', title: 'New Rust async scheduler', url: 'https://a.com/1' }),
      hs({ id: 'no', title: 'Cooking pasta tonight', url: 'https://b.com/2' }),
    ];
    const got = gatherCandidates(seed, pool, empty);
    const ids = got.map((c) => c.hotspot.id);
    expect(ids).toContain('m1');
    expect(ids).not.toContain('seed');
    expect(ids).not.toContain('no');
  });

  it('excludes ids already in the corpus (hs_ prefix) and matching urls', () => {
    const pool = [hs({ id: 'm1', title: 'Rust async news', url: 'https://a.com/1' })];
    const ex: ExistingCorpus = { ids: new Set(['hs_m1']), urls: new Set() };
    expect(gatherCandidates(seed, pool, ex)).toHaveLength(0);
    const ex2: ExistingCorpus = { ids: new Set(), urls: new Set(['https://a.com/1']) };
    expect(gatherCandidates(seed, pool, ex2)).toHaveLength(0);
  });

  it('skips unfetchable / SSRF urls', () => {
    const pool = [hs({ id: 'm1', title: 'Rust async loopback', url: 'http://127.0.0.1/secret' })];
    expect(gatherCandidates(seed, pool, empty)).toHaveLength(0);
  });

  it('enforces per-host cap and the overall budget', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      hs({ id: `h${i}`, title: 'Rust async runtime item', url: `https://same.com/${i}` }),
    );
    const capped = gatherCandidates(seed, many, empty);
    expect(capped.length).toBeLessThanOrEqual(MAX_INQUIRY);
    expect(capped.length).toBeLessThanOrEqual(PER_HOST_CAP); // all share one host
  });

  it('ranks higher overlap first (deterministic)', () => {
    const pool = [
      hs({ id: 'low', title: 'Rust thing', url: 'https://a.com/low' }),
      hs({ id: 'high', title: 'Rust async runtime benchmarks', url: 'https://b.com/high' }),
    ];
    const got = gatherCandidates(seed, pool, empty);
    expect(got[0]?.hotspot.id).toBe('high');
  });
});

describe('ruleLabel', () => {
  it('is always a neutral 补充 with the candidate rule confidence', () => {
    const label = ruleLabel({ hotspot: hs(), overlap: 2, sameHost: false, ruleConfidence: 0.42 });
    expect(label.klass).toBe('补充');
    expect(label.stance).toBe('neutral');
    expect(label.confidence).toBe(0.42);
  });
});

describe('runInquiry', () => {
  const seed = seedFromHotspot(hs({ id: 'seed', title: 'Rust async runtime', url: 'https://seed.com/x' }));
  const pool = [
    hs({ id: 'm1', title: 'Rust async scheduler', url: 'https://a.com/1' }),
    hs({ id: 'm2', title: 'async runtime in Rust', url: 'https://b.com/2' }),
  ];

  it('without a classifier shapes neutral 补充 evidence cards tagged to the seed', async () => {
    const r = await runInquiry({ seed, hotspots: pool, existing: empty, deps });
    expect(r.usedAgent).toBe(false);
    expect(r.cards.length).toBe(2);
    for (const c of r.cards) {
      expect(c.origin).toBe('auto');
      expect(c.klass).toBe('补充');
      expect(c.relatedTo).toEqual(['seed']);
      expect(c.id.startsWith('hs_')).toBe(true);
    }
  });

  it('applies agent verdicts by index and marks usedAgent', async () => {
    const classifier: AgentClassifier = {
      classify: async (_s, cands) =>
        cands.map((_c, i) => ({
          index: i,
          klass: i === 0 ? '对比' : '补充',
          stance: i === 0 ? 'contradict' : 'corroborate',
          confidence: 0.9,
          note: i === 0 ? '反驳了基准说法' : '佐证',
        })),
    };
    const r = await runInquiry({ seed, hotspots: pool, existing: empty, classifier, deps });
    expect(r.usedAgent).toBe(true);
    const contrast = r.cards.find((c) => c.klass === '对比');
    expect(contrast?.stance).toBe('contradict');
    expect(contrast?.note).toBe('反驳了基准说法');
  });

  it('falls back to rule labels when the classifier returns undefined or throws', async () => {
    const undef: AgentClassifier = { classify: async () => undefined };
    const thrown: AgentClassifier = { classify: async () => { throw new Error('agent down'); } };
    for (const classifier of [undef, thrown]) {
      const r = await runInquiry({ seed, hotspots: pool, existing: empty, classifier, deps });
      expect(r.usedAgent).toBe(false);
      expect(r.cards.every((c) => c.klass === '补充' && c.stance === 'neutral')).toBe(true);
    }
  });

  it('partial agent verdicts: missing indices fall back to rule labels', async () => {
    const classifier: AgentClassifier = {
      classify: async () => [{ index: 0, klass: '对比', stance: 'contradict', confidence: 0.8, note: 'x' }],
    };
    const r = await runInquiry({ seed, hotspots: pool, existing: empty, classifier, deps });
    expect(r.usedAgent).toBe(true);
    expect(r.cards.filter((c) => c.klass === '对比')).toHaveLength(1);
    expect(r.cards.filter((c) => c.klass === '补充')).toHaveLength(1); // the unrefined one
  });

  it('returns no cards when nothing overlaps', async () => {
    const r = await runInquiry({ seed, hotspots: [hs({ id: 'x', title: 'pasta recipe', url: 'https://c.com/3' })], existing: empty, deps });
    expect(r.cards).toHaveLength(0);
    expect(r.candidateCount).toBe(0);
  });
});
