// Daemon-internal collect types. Adapters are decoupled from @app/contracts: they emit the
// scorer-shaped ProvenanceNode, and the collector maps those into the contracts Hotspot. Everything
// here is injectable (fetch/now/signal) so the whole layer is unit-tested offline & deterministically.

import type { SourceType } from '@app/contracts';

/** Minimal Response shape the collect layer depends on — keeps adapters off the global `fetch` so
 *  tests inject a fake. The production adapter (refresh.ts) maps a real `Response` onto this. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  /** Header lookup (lowercased name), or null. Used for the response-size cap. */
  header(name: string): string | null;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; redirect?: 'follow' | 'manual' },
) => Promise<FetchResponse>;

export interface AdapterDeps {
  fetchImpl: FetchLike;
  /** ms epoch, injected (never Date.now() inside pure code). */
  now: () => number;
  signal?: AbortSignal;
  /** Test seam for backoff/timeout waits; defaults to a real timer in production wiring. */
  sleep?: (ms: number) => Promise<void>;
}

/** Scorer input: a normalized, source-agnostic hotspot record before id/score are assigned. */
export interface ProvenanceNode {
  sourceType: SourceType;
  title: string;
  url: string;
  excerpt: string;
  author?: string;
  points?: number;
  commentCount?: number;
  /** ISO-8601 or null when the source had no parseable date. */
  publishedAt: string | null;
  /** ISO-8601 capture time (collector clock); not scored, carried for bookkeeping. */
  fetchedAt: string;
  /** Stable per-source key (HN item id / feed guid) used to mint a deterministic Hotspot id. */
  key: string;
}

/** One pluggable source. `collect` is best-effort: it resolves whatever it could fetch and never
 *  throws for a partial/failed source (the orchestrator runs them under allSettled regardless). */
export interface SourceAdapter {
  id: string;
  sourceType: SourceType;
  collect(deps: AdapterDeps): Promise<ProvenanceNode[]>;
}

export interface ScoreWeights {
  recency: number;
  engagement: number;
  keyword: number;
}

export interface ScoreOpts {
  /** ms epoch, INJECTED (never Date.now()). */
  now: number;
  sourceWeights: Record<SourceType, number>;
  halfLifeHours?: number;
  keywords?: string[];
  weights?: ScoreWeights;
}

export interface CollectConfig {
  sources: SourceAdapter[];
  sourceWeights: Record<SourceType, number>;
  topN: number;
  perSourceCap: number;
  halfLifeHours?: number;
  keywords?: string[];
}
