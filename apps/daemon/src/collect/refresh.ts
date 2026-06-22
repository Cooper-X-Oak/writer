// Production wiring for a collection run: bind the real global fetch into the FetchLike shape, run
// the collector, persist the snapshot. This is the ONLY place global fetch is touched — every other
// part of the collect layer takes an injected fetchImpl so it stays offline-testable.
//
// realFetch is where the STREAMING size cap lives (the backstop the header-only cap in fetch-util
// defers to): the body is read chunk-by-chunk with a running total, and text()/json() THROW once the
// cap is exceeded — which fetchTextWithRetry/fetchJsonWithRetry catch and turn into null. This bounds
// a hostile feed that omits or lies about Content-Length and streams unbounded bytes.

import type { HotspotSnapshot } from '@app/contracts';
import type { CollectConfig, FetchLike, FetchResponse } from './types.js';
import { MAX_RESPONSE_BYTES } from './fetch-util.js';
import { collectHotspots } from './collector.js';
import { defaultCollectConfig } from './config.js';
import { defaultHotspotStore, type HotspotStore } from './store.js';

/** Read a Response body with a running-total byte cap; throws once the cap is exceeded. */
export async function boundedText(res: Response, maxBytes: number): Promise<string> {
  const body = res.body;
  if (!body) return res.text();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeds ${String(maxBytes)}-byte cap`);
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

/** The production FetchLike: wraps global fetch, honoring the manual-redirect flag and enforcing the
 *  streaming byte cap inside text()/json(). */
export function realFetch(maxBytes: number = MAX_RESPONSE_BYTES): FetchLike {
  return async (url, init): Promise<FetchResponse> => {
    const res = await fetch(url, { redirect: init?.redirect ?? 'follow', signal: init?.signal });
    return {
      ok: res.ok,
      status: res.status,
      header: (name) => res.headers.get(name),
      text: () => boundedText(res, maxBytes),
      json: async () => JSON.parse(await boundedText(res, maxBytes)) as unknown,
    };
  };
}

export interface RefreshDeps {
  config: CollectConfig;
  store: HotspotStore;
  fetchImpl: FetchLike;
  now: () => number;
}

/** Build a refresh function: collect best-effort, persist the snapshot, return it. */
export function createRefresh(deps: RefreshDeps): () => Promise<HotspotSnapshot> {
  return async () => {
    const snapshot = await collectHotspots(deps.config, { fetchImpl: deps.fetchImpl, now: deps.now });
    await deps.store.save(snapshot);
    return snapshot;
  };
}

/** Production refresh: real config (env-driven feeds) + real fetch + real store + real clock. NOT
 *  exercised by offline tests (it hits the network); createRefresh carries the tested logic. */
export function defaultRefresh(): Promise<HotspotSnapshot> {
  return createRefresh({
    config: defaultCollectConfig(),
    store: defaultHotspotStore,
    fetchImpl: realFetch(),
    now: () => Date.now(),
  })();
}
