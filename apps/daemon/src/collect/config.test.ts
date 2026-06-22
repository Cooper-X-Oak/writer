import { describe, it, expect } from 'vitest';
import {
  parseFeedUrls,
  mergeFeeds,
  parseHnChannels,
  HN_CHANNEL_URL,
  defaultCollectConfig,
  DEFAULT_SOURCE_WEIGHTS,
  DEFAULT_TOP_N,
  MAX_FEEDS,
} from './config.js';
import type { FeedsStore } from './feeds-store.js';

const fakeFeedsStore = (urls: string[]): FeedsStore => ({ read: () => Promise.resolve(urls), save: () => Promise.resolve() });

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

describe('mergeFeeds', () => {
  it('unions, dedupes, validates, and caps across lists', () => {
    expect(mergeFeeds(['https://a.com/f', 'http://127.0.0.1/x'], ['https://a.com/f', 'https://b.com/f'])).toEqual([
      'https://a.com/f',
      'https://b.com/f',
    ]);
  });
});

describe('parseHnChannels', () => {
  it('defaults to [top] when unset; parses + dedupes valid channels; ignores junk', () => {
    expect(parseHnChannels(undefined)).toEqual(['top']);
    expect(parseHnChannels('top, best, best, bogus')).toEqual(['top', 'best']);
    expect(parseHnChannels('nonsense')).toEqual(['top']); // no valid → fallback
    expect(HN_CHANNEL_URL.best).toContain('beststories.json');
  });
});

describe('defaultCollectConfig (async)', () => {
  it('builds hn + rss adapters with default weights and caps; empty RSS by default', async () => {
    const cfg = await defaultCollectConfig({} as NodeJS.ProcessEnv, fakeFeedsStore([]));
    expect(cfg.sources.map((s) => s.sourceType)).toEqual(['hn', 'rss']); // 1 hn channel + rss
    expect(cfg.sourceWeights).toEqual(DEFAULT_SOURCE_WEIGHTS);
    expect(cfg.topN).toBe(DEFAULT_TOP_N);
    expect(cfg.keywords).toBeUndefined();
  });

  it('merges env feeds with the persisted feeds.json list', async () => {
    const cfg = await defaultCollectConfig(
      { HOTSPOT_RSS_FEEDS: 'https://a.com/f', HOTSPOT_KEYWORDS: 'rust, wasm' } as NodeJS.ProcessEnv,
      fakeFeedsStore(['https://b.com/f']),
    );
    expect(cfg.sources.map((s) => s.sourceType)).toEqual(['hn', 'rss']);
    expect(cfg.keywords).toEqual(['rust', 'wasm']);
  });

  it('builds one HN adapter per configured channel', async () => {
    const cfg = await defaultCollectConfig({ HOTSPOT_HN_CHANNELS: 'top,best,show' } as NodeJS.ProcessEnv, fakeFeedsStore([]));
    expect(cfg.sources.filter((s) => s.sourceType === 'hn')).toHaveLength(3);
    expect(cfg.sources.filter((s) => s.sourceType === 'rss')).toHaveLength(1);
  });
});
