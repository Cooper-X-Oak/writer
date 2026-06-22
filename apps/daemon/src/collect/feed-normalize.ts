// The canonical feed-list normalizer, shared by env parsing (config.ts), the persisted feeds.json
// reader (feeds-store.ts), and the /api/feeds route. Kept in its own module so feeds-store and
// config don't form an import cycle. The SSRF boundary is isFetchableUrl (http/https scheme +
// non-private/loopback host); the cap bounds outbound fan-out.

import { isFetchableUrl } from './fetch-util.js';

export const MAX_FEEDS = 16;

/** Trim, drop empties/dupes, keep only fetchable http(s) URLs, cap the count. */
export function normalizeFeeds(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = raw.trim();
    if (!url || seen.has(url) || !isFetchableUrl(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_FEEDS) break;
  }
  return out;
}

/** Merge any number of feed lists into one bounded, deduped, validated list. */
export function mergeFeeds(...lists: string[][]): string[] {
  return normalizeFeeds(lists.flat());
}

/** Parse the comma-separated HOTSPOT_RSS_FEEDS env var. */
export function parseFeedUrls(raw: string | undefined): string[] {
  return raw ? normalizeFeeds(raw.split(',')) : [];
}
