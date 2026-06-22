// RSS 2.0 + Atom 1.0 adapter. Pure parse/normalize over fast-xml-parser (no native deps, Windows-safe).
// SECURITY (verified against fast-xml-parser 5.9.3): it has NO external-entity resolver, so classic
// XXE file-read / SSRF-via-SYSTEM-entity is unreachable. We additionally set processEntities:false
// (strongest stance — predefined/numeric refs are still decoded by our own decodeEntities) and wrap
// parse() in try/catch returning [] so a malformed/entity-bomb feed can never crash a refresh run.
// RSS 1.0/RDF is detected and skipped cleanly (out of MVP scope).

import { createHash } from 'node:crypto';
import { XMLParser, type X2jOptions } from 'fast-xml-parser';
import type { ProvenanceNode, SourceAdapter, AdapterDeps } from '../types.js';
import { fetchTextWithRetry, mapPool, isFetchableUrl } from '../fetch-util.js';
import { decodeEntities, stripHtml, cleanExcerpt } from '../html.js';

export const FEED_PARSER_OPTIONS: X2jOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  cdataPropName: '#cdata',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  htmlEntities: false, // we decode entities ourselves (decodeEntities) for one canonical path
  processEntities: false, // no DTD/custom-entity expansion → closes the billion-laughs surface
  ignoreDeclaration: true,
  ignorePiTags: true,
  maxNestedTags: 100,
};

const FEED_POOL_LIMIT = 4;

const ZONE_OFFSETS: Record<string, string> = {
  UT: '+0000', GMT: '+0000', Z: '+0000',
  EST: '-0500', EDT: '-0400', CST: '-0600', CDT: '-0500',
  MST: '-0700', MDT: '-0600', PST: '-0800', PDT: '-0700',
};

type Tree = Record<string, unknown>;
type Node = Record<string, unknown>;

function asRecord(v: unknown): Node | null {
  return typeof v === 'object' && v !== null ? (v as Node) : null;
}

function asArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Extract the text of a parsed node: a string, or a {#text}/{#cdata} wrapper. (parseTagValue is
 *  off, so every leaf value is a string or an object — never a number.) */
function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  const rec = asRecord(v);
  if (!rec) return '';
  const cdata = rec['#cdata'];
  const text = rec['#text'];
  if (typeof cdata === 'string') return cdata;
  if (typeof text === 'string') return text;
  return '';
}

function plainText(raw: unknown): string {
  return stripHtml(decodeEntities(textOf(raw)));
}

export function detectFormat(tree: unknown): 'rss2' | 'atom' | 'rss1-rdf' | 'unknown' {
  const t = asRecord(tree);
  if (!t) return 'unknown';
  if (t.rss !== undefined) return 'rss2';
  if (t.feed !== undefined) return 'atom';
  if (t['rdf:RDF'] !== undefined) return 'rss1-rdf';
  return 'unknown';
}

/** Parse an RSS RFC-822 or Atom RFC-3339 date into a canonical UTC ISO string, or null if missing /
 *  ambiguous (no timezone). Never assumes local time — that would be machine-TZ-dependent. */
export function parseFeedDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // ISO-8601 (Atom): require an explicit zone (Z or ±HH:MM) for a deterministic instant.
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return null;
    return isoOrNull(s);
  }
  // RFC-822 (RSS): normalize a trailing alpha zone to a numeric offset; require SOME zone.
  const alpha = /\b([A-Za-z]{2,4})$/.exec(s);
  if (alpha) {
    const zone = (alpha[1] ?? '').toUpperCase();
    const offset = ZONE_OFFSETS[zone];
    if (!offset) return null; // unknown alpha zone → treat as missing
    return isoOrNull(s.replace(/\b[A-Za-z]{2,4}$/, offset));
  }
  if (!/[+-]\d{4}$/.test(s)) return null; // no numeric offset either → ambiguous → missing
  return isoOrNull(s);
}

function isoOrNull(s: string): string | null {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Resolve a (possibly relative) link against the feed/base URL; null if not a valid http(s) URL. */
export function resolveLink(href: string, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function stableKey(...parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/** Pick the human-facing Atom link (rel="alternate" or the first link without rel). */
function pickAtomLink(linkNode: unknown, base: string): string | null {
  const links = asArray(linkNode);
  let fallback: string | null = null;
  for (const raw of links) {
    if (typeof raw === 'string') {
      fallback ??= resolveLink(raw, base);
      continue;
    }
    const rec = asRecord(raw);
    const href = rec && typeof rec['@_href'] === 'string' ? rec['@_href'] : '';
    const rel = rec && typeof rec['@_rel'] === 'string' ? rec['@_rel'] : 'alternate';
    if (!href) continue;
    if (rel === 'alternate') return resolveLink(href, base);
    fallback ??= resolveLink(href, base);
  }
  return fallback;
}

function mapRssItem(item: Node, feedUrl: string, fetchedAt: string): ProvenanceNode | null {
  const title = plainText(item.title);
  const link = resolveLink(textOf(item.link), feedUrl);
  const guidText = textOf(item.guid);
  const publishedAt = parseFeedDate(textOf(item.pubDate) || undefined);
  const url = link ?? (isFetchableUrl(guidText) ? guidText : feedUrl);
  const key = guidText || link || stableKey(title, publishedAt ?? '');
  if (!title && !link && !guidText) return null; // nothing to identify or cite
  return {
    sourceType: 'rss',
    title: title || '(untitled)',
    url,
    excerpt: cleanExcerpt(textOf(item.description)),
    author: rssAuthor(item),
    publishedAt,
    fetchedAt,
    key,
  };
}

function rssAuthor(item: Node): string | undefined {
  const a = textOf(item.author) || textOf(item['dc:creator']);
  return a || undefined;
}

function mapAtomEntry(entry: Node, feedUrl: string, base: string, fetchedAt: string): ProvenanceNode | null {
  const title = plainText(entry.title);
  const link = pickAtomLink(entry.link, base);
  const idText = textOf(entry.id);
  const publishedAt = parseFeedDate(textOf(entry.updated) || textOf(entry.published) || undefined);
  const url = link ?? (isFetchableUrl(idText) ? idText : feedUrl);
  const key = idText || link || stableKey(title, publishedAt ?? '');
  if (!title && !link && !idText) return null;
  return {
    sourceType: 'rss',
    title: title || '(untitled)',
    url,
    excerpt: cleanExcerpt(textOf(entry.summary) || textOf(entry.content)),
    author: plainText(asRecord(entry.author)?.name) || undefined,
    publishedAt,
    fetchedAt,
    key,
  };
}

function mapRss(tree: Tree, feedUrl: string, fetchedAt: string): ProvenanceNode[] {
  const channel = asRecord(asRecord(tree.rss)?.channel);
  if (!channel) return [];
  return asArray(channel.item)
    .map((it) => (asRecord(it) ? mapRssItem(asRecord(it) as Node, feedUrl, fetchedAt) : null))
    .filter((n): n is ProvenanceNode => n !== null);
}

function mapAtom(tree: Tree, feedUrl: string, fetchedAt: string): ProvenanceNode[] {
  const feed = asRecord(tree.feed);
  if (!feed) return [];
  const base = typeof feed['@_xml:base'] === 'string' ? feed['@_xml:base'] : feedUrl;
  return asArray(feed.entry)
    .map((e) => (asRecord(e) ? mapAtomEntry(asRecord(e) as Node, feedUrl, base, fetchedAt) : null))
    .filter((n): n is ProvenanceNode => n !== null);
}

/** Parse a feed document into ProvenanceNodes. Returns [] on ANY parse failure (malformed XML,
 *  entity/nesting limits) or unsupported format — never throws, so one bad feed can't sink a run. */
export function parseFeed(xml: string, feedUrl: string, fetchedAt: string): ProvenanceNode[] {
  let tree: unknown;
  try {
    tree = new XMLParser(FEED_PARSER_OPTIONS).parse(xml);
  } catch {
    return [];
  }
  const fmt = detectFormat(tree);
  const t = tree as Tree;
  if (fmt === 'rss2') return mapRss(t, feedUrl, fetchedAt);
  if (fmt === 'atom') return mapAtom(t, feedUrl, fetchedAt);
  return []; // rss1-rdf / unknown → skip cleanly
}

export function createRssAdapter(feedUrls: string[]): SourceAdapter {
  return {
    id: 'rss',
    sourceType: 'rss',
    async collect(deps: AdapterDeps): Promise<ProvenanceNode[]> {
      const fetchedAt = new Date(deps.now()).toISOString();
      const perFeed = await mapPool(feedUrls, FEED_POOL_LIMIT, async (url) => {
        const xml = await fetchTextWithRetry(deps, url);
        return xml ? parseFeed(xml, url, fetchedAt) : [];
      });
      return perFeed.flat();
    },
  };
}
