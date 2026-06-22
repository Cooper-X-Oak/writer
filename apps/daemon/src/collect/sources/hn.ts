// Hacker News adapter (official Firebase API, zero ToS). List endpoints return ONLY ids, so the
// adapter is: fetch topstories → hard-cap top N → fetch each /item via a bounded pool (each item
// independently failable → null + filter, so one bad id never sinks the batch) → normalize.
// Gotchas baked in (live-verified): item.time is UNIX SECONDS (×1000); title is HTML-escaped
// (decode); link stories have a url, Ask/Show/text posts do NOT (fall back to the HN permalink).

import type { ProvenanceNode, SourceAdapter, AdapterDeps } from '../types.js';
import { fetchJsonWithRetry, mapPool } from '../fetch-util.js';
import { decodeEntities, cleanExcerpt } from '../html.js';

export const HN_LIST_URL = 'https://hacker-news.firebaseio.com/v0/topstories.json';
export const HN_ITEM_BASE = 'https://hacker-news.firebaseio.com/v0/item/';
export const HN_DEFAULT_N = 30;
export const HN_MAX_N = 50;
const POOL_LIMIT = 6;

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

function itemUrl(id: number): string {
  return `${HN_ITEM_BASE}${String(id)}.json`;
}

/** Normalize one raw HN item into a ProvenanceNode, or null if it is not a live story. */
export function mapHnItem(raw: unknown, fetchedAt: string): ProvenanceNode | null {
  const item = asRecord(raw);
  if (!item) return null;
  if (item.deleted === true || item.dead === true) return null;
  if (item.type !== 'story') return null;
  if (typeof item.id !== 'number' || typeof item.title !== 'string') return null;

  const id = item.id;
  const url = typeof item.url === 'string' && item.url ? item.url : `https://news.ycombinator.com/item?id=${String(id)}`;
  const publishedAt =
    typeof item.time === 'number' && Number.isFinite(item.time)
      ? new Date(item.time * 1000).toISOString()
      : null;

  return {
    sourceType: 'hn',
    title: decodeEntities(item.title),
    url,
    excerpt: cleanExcerpt(typeof item.text === 'string' ? item.text : undefined),
    author: typeof item.by === 'string' ? item.by : undefined,
    points: typeof item.score === 'number' ? item.score : undefined,
    commentCount: typeof item.descendants === 'number' ? item.descendants : 0,
    publishedAt,
    fetchedAt,
    key: String(id),
  };
}

export interface HnAdapterOpts {
  listUrl?: string;
  n?: number;
}

export function createHnAdapter(opts: HnAdapterOpts = {}): SourceAdapter {
  const listUrl = opts.listUrl ?? HN_LIST_URL;
  const n = Math.max(1, Math.min(opts.n ?? HN_DEFAULT_N, HN_MAX_N));
  return {
    id: 'hn:topstories',
    sourceType: 'hn',
    async collect(deps: AdapterDeps): Promise<ProvenanceNode[]> {
      const fetchedAt = new Date(deps.now()).toISOString();
      const list = await fetchJsonWithRetry(deps, listUrl);
      if (!Array.isArray(list)) return [];
      const ids = list.filter((x): x is number => typeof x === 'number').slice(0, n);
      const items = await mapPool(ids, POOL_LIMIT, (id) => fetchJsonWithRetry(deps, itemUrl(id)));
      const nodes: ProvenanceNode[] = [];
      for (const raw of items) {
        const node = mapHnItem(raw, fetchedAt);
        if (node) nodes.push(node);
      }
      return nodes;
    },
  };
}
