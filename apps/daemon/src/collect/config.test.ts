import { describe, it, expect } from 'vitest';
import { parseFeedUrls, defaultCollectConfig, DEFAULT_SOURCE_WEIGHTS, DEFAULT_TOP_N, MAX_FEEDS } from './config.js';

describe('parseFeedUrls', () => {
  it('splits, trims, drops empties, and dedupes', () => {
    expect(parseFeedUrls(' https://a.com/f , https://b.com/f ,, https://a.com/f ')).toEqual([
      'https://a.com/f',
      'https://b.com/f',
    ]);
  });
  it('rejects non-http(s) and private/loopback URLs', () => {
    expect(parseFeedUrls('ftp://a.com,file:///x,http://127.0.0.1/f,https://ok.com/f')).toEqual(['https://ok.com/f']);
  });
  it('defaults to [] when unset/empty', () => {
    expect(parseFeedUrls(undefined)).toEqual([]);
    expect(parseFeedUrls('')).toEqual([]);
  });
  it('caps the list length at MAX_FEEDS', () => {
    const many = Array.from({ length: 30 }, (_, i) => `https://e${String(i)}.com/f`).join(',');
    expect(parseFeedUrls(many)).toHaveLength(MAX_FEEDS);
  });
});

describe('defaultCollectConfig', () => {
  it('builds hn + rss adapters with default weights and caps; RSS default is empty', () => {
    const cfg = defaultCollectConfig({} as NodeJS.ProcessEnv);
    expect(cfg.sources.map((s) => s.sourceType)).toEqual(['hn', 'rss']);
    expect(cfg.sourceWeights).toEqual(DEFAULT_SOURCE_WEIGHTS);
    expect(cfg.topN).toBe(DEFAULT_TOP_N);
    expect(cfg.keywords).toBeUndefined();
  });
  it('reads HOTSPOT_RSS_FEEDS and HOTSPOT_KEYWORDS from the injected env', () => {
    const cfg = defaultCollectConfig({
      HOTSPOT_RSS_FEEDS: 'https://a.com/f',
      HOTSPOT_KEYWORDS: 'rust, wasm',
    } as NodeJS.ProcessEnv);
    expect(cfg.sources).toHaveLength(2);
    expect(cfg.keywords).toEqual(['rust', 'wasm']);
  });
});
