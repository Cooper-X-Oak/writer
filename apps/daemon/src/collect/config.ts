// Default collection config. Feed URLs come from env HOTSPOT_RSS_FEEDS (comma-separated); the
// default list is EMPTY by design — HN is the zero-risk out-of-the-box source, and the user opts
// into RSS by configuring feeds. Feed URLs are validated (http/https, non-private) and the list
// length is capped (bounds fan-out, a security must-fix).

import type { CollectConfig } from './types.js';
import type { SourceType } from '@app/contracts';
import { isFetchableUrl } from './fetch-util.js';
import { createHnAdapter } from './sources/hn.js';
import { createRssAdapter } from './sources/rss.js';

export const DEFAULT_SOURCE_WEIGHTS: Record<SourceType, number> = { hn: 1.0, rss: 0.8 };
export const DEFAULT_TOP_N = 20;
export const DEFAULT_PER_SOURCE_CAP = 10;
export const MAX_FEEDS = 16;

/** Parse the comma-separated HOTSPOT_RSS_FEEDS list: trim, drop empties/dupes, keep only fetchable
 *  http(s) URLs, cap the count. Defaults to [] (no baked-in feeds). */
export function parseFeedUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const url = part.trim();
    if (!url || seen.has(url) || !isFetchableUrl(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_FEEDS) break;
  }
  return out;
}

function parseKeywords(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const kws = raw.split(',').map((k) => k.trim()).filter((k) => k.length > 0);
  return kws.length > 0 ? kws : undefined;
}

export function defaultCollectConfig(env: NodeJS.ProcessEnv = process.env): CollectConfig {
  const feedUrls = parseFeedUrls(env.HOTSPOT_RSS_FEEDS);
  return {
    sources: [createHnAdapter(), createRssAdapter(feedUrls)],
    sourceWeights: DEFAULT_SOURCE_WEIGHTS,
    topN: DEFAULT_TOP_N,
    perSourceCap: DEFAULT_PER_SOURCE_CAP,
    keywords: parseKeywords(env.HOTSPOT_KEYWORDS),
  };
}
