// collect.ts — hotspot collection layer. Internal API surface → plain TS interfaces (PLAN.md §2.4).
// zod validation of UNTRUSTED feed/HN input lives in the daemon collect layer, NOT here.

export type SourceType = 'hn' | 'rss';

/** A scored, collection-time hotspot record. Immutable; built once by the collector, never mutated. */
export interface Hotspot {
  /** Deterministic stable id derived from sourceType + canonical key (HN item id / feed guid). */
  id: string;
  sourceType: SourceType;
  title: string;
  /** Canonical, absolute URL. Never empty (HN falls back to the item permalink). */
  url: string;
  /** Plain-text excerpt (HTML-stripped, ≤280 chars). '' when the source carries no body. */
  excerpt: string;
  author?: string;
  /** HN points; absent for RSS. */
  points?: number;
  /** HN comment count; 0 when absent. */
  commentCount?: number;
  /** When the SOURCE published (recency signal). ISO-8601, or null when unknown/unparseable. */
  publishedAt: string | null;
  /** When WE fetched it (provenance bookkeeping, NOT freshness). ISO-8601. */
  fetchedAt: string;
  /** Deterministic rule score in [0, maxSourceWeight]. */
  score: number;
}

/** Snapshot persisted to hotspots.json — the whole result of one collection run. */
export interface HotspotSnapshot {
  /** When this collection run completed. ISO-8601. */
  collectedAt: string;
  hotspots: Hotspot[];
}

/** The GET/POST/DELETE /api/feeds envelope — the persisted, normalized user RSS feed URLs. */
export interface FeedsResponse {
  feeds: string[];
}
