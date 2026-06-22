// Tolerant validation of material cards. materials.json is hand-editable → UNTRUSTED on read, so
// parseCards re-runs every guard (typeof + enum + SSRF) and DROPS malformed cards/fields instead of
// throwing. Mirrors parseManifest (manifest.ts) and parseFeedList (feeds-store.ts). SECURITY: the
// SSRF boundary is isFetchableUrl (fetch-util.ts) — the loopback/private/metadata guard — NOT the
// scheme-only check in provenance.ts. A link card with an unfetchable url is dropped whole; a
// non-link card with a bad source.url keeps the card but drops the source.

import type { MaterialCard, CardKind, CardOrigin, CardClass, CardSource } from '@app/contracts';
import { isFetchableUrl } from '../collect/fetch-util.js';
import { isSafeImageName } from '../workspace/paths.js';

const KINDS = new Set<CardKind>(['link', 'image', 'md', 'text', 'code']);
const ORIGINS = new Set<CardOrigin>(['auto', 'manual']);
const CLASSES = new Set<CardClass>(['原始', '补充', '对比']);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function clamp01(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Keep only valid fields; a non-http(s)/loopback url is dropped. Returns undefined if nothing left. */
function parseSource(raw: unknown): CardSource | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const src: CardSource = {};
  if (typeof o.url === 'string' && isFetchableUrl(o.url)) src.url = o.url;
  if (typeof o.title === 'string') src.title = o.title;
  if (typeof o.author === 'string') src.author = o.author;
  if (typeof o.date === 'string') src.date = o.date;
  return Object.keys(src).length > 0 ? src : undefined;
}

export function parseCard(raw: unknown): MaterialCard | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return undefined;
  if (typeof o.kind !== 'string' || !KINDS.has(o.kind as CardKind)) return undefined;
  if (typeof o.origin !== 'string' || !ORIGINS.has(o.origin as CardOrigin)) return undefined;
  if (typeof o.klass !== 'string' || !CLASSES.has(o.klass as CardClass)) return undefined;
  if (typeof o.addedAt !== 'string') return undefined;
  const content = o.content;
  if (typeof content !== 'object' || content === null) return undefined;
  const c = content as Record<string, unknown>;

  const source = parseSource(o.source);
  const base = {
    id: o.id,
    origin: o.origin as CardOrigin,
    klass: o.klass as CardClass,
    confidence: clamp01(o.confidence),
    tags: strArray(o.tags),
    note: typeof o.note === 'string' ? o.note : '',
    addedAt: o.addedAt,
    ...(source ? { source } : {}),
  };

  switch (o.kind as CardKind) {
    case 'link': {
      if (typeof c.url !== 'string' || !isFetchableUrl(c.url)) return undefined; // a link is its url
      return {
        ...base,
        kind: 'link',
        content: {
          url: c.url,
          excerpt: typeof c.excerpt === 'string' ? c.excerpt : '',
          ...(typeof c.title === 'string' ? { title: c.title } : {}),
        },
      };
    }
    case 'image': {
      if (typeof c.filename !== 'string' || !isSafeImageName(c.filename)) return undefined;
      if (typeof c.contentType !== 'string' || !IMAGE_TYPES.has(c.contentType)) return undefined;
      return {
        ...base,
        kind: 'image',
        content: {
          filename: c.filename,
          alt: typeof c.alt === 'string' ? c.alt : '',
          contentType: c.contentType,
          ...(typeof c.width === 'number' ? { width: c.width } : {}),
          ...(typeof c.height === 'number' ? { height: c.height } : {}),
        },
      };
    }
    case 'md':
    case 'text': {
      if (typeof c.body !== 'string') return undefined;
      return { ...base, kind: o.kind as 'md' | 'text', content: { body: c.body } };
    }
    case 'code': {
      if (typeof c.snippet !== 'string') return undefined;
      return {
        ...base,
        kind: 'code',
        content: { snippet: c.snippet, ...(typeof c.language === 'string' ? { language: c.language } : {}) },
      };
    }
    default:
      return undefined;
  }
}

/** Accepts `{cards:MaterialCard[]}` or a bare array; []-on-bad-JSON; drops individual malformed cards. */
export function parseCards(json: string): MaterialCard[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { cards?: unknown }).cards)
      ? (parsed as { cards: unknown[] }).cards
      : [];
  return raw.map(parseCard).filter((c): c is MaterialCard => c !== undefined);
}
