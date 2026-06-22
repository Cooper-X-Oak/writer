// Build a MaterialCard from a manual drop or a collected Hotspot. Pure (IO-free): the store writes
// image bytes and persists; these only shape the card. `now`/`genId` are injectable for tests.

import type { Hotspot, CardLink, CardImage, CardMd, CardText, CardCode } from '@app/contracts';
import { cleanExcerpt, truncate } from '../collect/html.js';
import { isFetchableUrl } from '../collect/fetch-util.js';
import { createProjectId } from '../workspace/paths.js';

export interface NormalizeDeps {
  now?: () => Date;
  genId?: () => string;
}

/** Per-card text body cap — bounds materials.json size and the read-time reparse cost. */
export const MAX_BODY_LEN = 100_000;

function base(deps: NormalizeDeps) {
  return {
    origin: 'manual' as const,
    klass: '原始' as const,
    confidence: 1,
    tags: [] as string[],
    note: '',
    addedAt: (deps.now ? deps.now() : new Date()).toISOString(),
    id: deps.genId ? deps.genId() : createProjectId(),
  };
}

/** Paste-only in W1 — no outbound fetch. Returns undefined if the url is not fetchable (SSRF/scheme). */
export function linkCard(
  input: { url: string; excerpt?: string; title?: string; note?: string },
  deps: NormalizeDeps = {},
): CardLink | undefined {
  if (!isFetchableUrl(input.url)) return undefined;
  return {
    ...base(deps),
    ...(input.note ? { note: input.note } : {}),
    kind: 'link',
    content: {
      url: input.url,
      excerpt: cleanExcerpt(input.excerpt ?? '', 280),
      ...(input.title ? { title: input.title } : {}),
    },
  };
}

export function textCard(body: string, deps: NormalizeDeps = {}): CardText {
  return { ...base(deps), kind: 'text', content: { body: truncate(body, MAX_BODY_LEN) } };
}

export function mdCard(body: string, deps: NormalizeDeps = {}): CardMd {
  return { ...base(deps), kind: 'md', content: { body: truncate(body, MAX_BODY_LEN) } };
}

export function codeCard(input: { snippet: string; language?: string }, deps: NormalizeDeps = {}): CardCode {
  return {
    ...base(deps),
    kind: 'code',
    content: {
      snippet: truncate(input.snippet, MAX_BODY_LEN),
      ...(input.language ? { language: input.language.toLowerCase() } : {}),
    },
  };
}

/** The store computes the sha256 filename + writes the blob; this only shapes the card. */
export function imageCard(
  input: { filename: string; contentType: string; alt?: string },
  deps: NormalizeDeps = {},
): CardImage {
  return {
    ...base(deps),
    kind: 'image',
    content: { filename: input.filename, alt: input.alt ?? '', contentType: input.contentType },
  };
}

/** D7 convergence seam: a collected hotspot → an auto link card. Deterministic id → idempotent. */
export function hotspotToCard(h: Hotspot, deps: NormalizeDeps = {}): CardLink {
  const score = typeof h.score === 'number' && Number.isFinite(h.score) ? Math.min(1, Math.max(0, h.score)) : 1;
  return {
    ...base(deps),
    id: `hs_${h.id}`,
    origin: 'auto',
    confidence: score,
    source: {
      url: h.url,
      title: h.title,
      ...(h.author ? { author: h.author } : {}),
      ...(h.publishedAt ? { date: h.publishedAt } : {}),
    },
    kind: 'link',
    content: { url: h.url, excerpt: cleanExcerpt(h.excerpt ?? '', 280), title: h.title },
  };
}
