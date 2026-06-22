// Default collection config. Feed URLs come from env HOTSPOT_RSS_FEEDS (comma-separated) AND a
// persisted user list (feeds.json, managed via /api/feeds) — merged, validated (http/https,
// non-private via isFetchableUrl), deduped, and capped (bounds fan-out). The baked-in default is
// EMPTY by design — HN is the zero-risk out-of-the-box source; RSS is opt-in. Out-of-box breadth
// comes from HN channels (top/best/new/ask/show), not from third-party feeds we didn't choose.

import type { CollectConfig, SourceAdapter } from './types.js';
import type { SourceType } from '@app/contracts';
import { createHnAdapter, HN_LIST_URL } from './sources/hn.js';
import { createRssAdapter } from './sources/rss.js';
import { defaultFeedsStore, type FeedsStore } from './feeds-store.js';
import { mergeFeeds, parseFeedUrls } from './feed-normalize.js';

export { MAX_FEEDS, normalizeFeeds, mergeFeeds, parseFeedUrls } from './feed-normalize.js';

export const DEFAULT_SOURCE_WEIGHTS: Record<SourceType, number> = { hn: 1.0, rss: 0.8 };
export const DEFAULT_TOP_N = 20;
export const DEFAULT_PER_SOURCE_CAP = 10;

export type HnChannel = 'top' | 'best' | 'new' | 'ask' | 'show';
const HN_BASE = 'https://hacker-news.firebaseio.com/v0/';
export const HN_CHANNEL_URL: Record<HnChannel, string> = {
  top: HN_LIST_URL, // .../topstories.json
  best: `${HN_BASE}beststories.json`,
  new: `${HN_BASE}newstories.json`,
  ask: `${HN_BASE}askstories.json`,
  show: `${HN_BASE}showstories.json`,
};
export const DEFAULT_HN_CHANNELS: HnChannel[] = ['top'];

function isHnChannel(s: string): s is HnChannel {
  return s === 'top' || s === 'best' || s === 'new' || s === 'ask' || s === 'show';
}

/** Parse HOTSPOT_HN_CHANNELS (comma list); falls back to DEFAULT_HN_CHANNELS when unset/empty. */
export function parseHnChannels(raw: string | undefined): HnChannel[] {
  if (!raw) return DEFAULT_HN_CHANNELS;
  const seen = new Set<HnChannel>();
  for (const part of raw.split(',')) {
    const ch = part.trim().toLowerCase();
    if (isHnChannel(ch)) seen.add(ch);
  }
  return seen.size > 0 ? [...seen] : DEFAULT_HN_CHANNELS;
}

function parseKeywords(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const kws = raw.split(',').map((k) => k.trim()).filter((k) => k.length > 0);
  return kws.length > 0 ? kws : undefined;
}

/** Build the collection config. ASYNC because it reads the persisted feeds.json; the result is
 *  rebuilt per refresh run, so a feeds/channel edit takes effect on the next /hotspots/refresh. */
export async function defaultCollectConfig(
  env: NodeJS.ProcessEnv = process.env,
  feedsStore: FeedsStore = defaultFeedsStore,
): Promise<CollectConfig> {
  const fileFeeds = await feedsStore.read();
  const feedUrls = mergeFeeds(parseFeedUrls(env.HOTSPOT_RSS_FEEDS), fileFeeds);
  const hnAdapters: SourceAdapter[] = parseHnChannels(env.HOTSPOT_HN_CHANNELS).map((ch) =>
    createHnAdapter({ listUrl: HN_CHANNEL_URL[ch] }),
  );
  return {
    sources: [...hnAdapters, createRssAdapter(feedUrls)],
    sourceWeights: DEFAULT_SOURCE_WEIGHTS,
    topN: DEFAULT_TOP_N,
    perSourceCap: DEFAULT_PER_SOURCE_CAP,
    keywords: parseKeywords(env.HOTSPOT_KEYWORDS),
  };
}
