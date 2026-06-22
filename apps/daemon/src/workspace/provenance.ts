// Validate untrusted hotspot provenance before it is threaded into a write / persisted to a
// manifest. A malformed source is silently dropped (treated as absent) — it never blocks a write
// and a non-http(s) url never reaches manifest.json (closing a latent href/redirect sink even
// though P7 does not yet render source.url). Shared by the write route and the manifest reader.

import type { WriteSource, SourceType } from '@app/contracts';

const SOURCE_TYPES = new Set<SourceType>(['hn', 'rss']);

export function parseWriteSource(raw: unknown): WriteSource | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.hotspotId !== 'string' || !o.hotspotId) return undefined;
  if (typeof o.collectedAt !== 'string' || !o.collectedAt) return undefined;
  if (typeof o.sourceType !== 'string' || !SOURCE_TYPES.has(o.sourceType as SourceType)) return undefined;
  if (typeof o.url !== 'string') return undefined;
  let u: URL;
  try {
    u = new URL(o.url);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  return { hotspotId: o.hotspotId, sourceType: o.sourceType as SourceType, url: o.url, collectedAt: o.collectedAt };
}
