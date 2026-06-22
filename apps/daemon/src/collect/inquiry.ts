// W2 询证 (evidence-gathering) core. Given a SEED (a hotspot, an existing 原始 card, or a free query),
// gather "补充/对比" candidates from the ALREADY-COLLECTED hotspot snapshot (snapshot-first: offline,
// deterministic, no new network), dedup against the corpus, budget-cap, and classify. Two tiers,
// mirroring the collect layer's "rule prefilter + model only at the judgment" philosophy and score.ts's
// graceful degradation: Tier A (here) is pure rule; Tier B is an injectable AgentClassifier that refines
// the rule labels and falls back to them on any failure. Pure + IO-free except via injected deps.

import type { Hotspot, MaterialCard, CardLink, CardClass, CardStance } from '@app/contracts';
import { evidenceCard, type EvidenceLabel, type NormalizeDeps } from '../corpus/normalize.js';
import { isFetchableUrl } from './fetch-util.js';

/** Budget: never gather more than this many candidates per 询证 run (cost/noise cap). */
export const MAX_INQUIRY = 12;
/** Diversity: at most this many candidates from one host, so one busy domain can't dominate. */
export const PER_HOST_CAP = 3;
const DEFAULT_MIN_OVERLAP = 1;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'is', 'are', 'was', 'were',
  'be', 'by', 'as', 'at', 'from', 'that', 'this', 'it', 'its', 'their', 'your', 'our', 'you', 'we',
  'they', 'about', 'into', 'over', 'after', 'new', 'how', 'why', 'what', 'when', 'where', 'which',
  'will', 'can', 'has', 'have', 'not', 'but', 'his', 'her',
]);

/** A normalized statement of what we're gathering evidence FOR. */
export interface Seed {
  /** Back-link id recorded as relatedTo on each evidence card; '' for a free-query seed (no card). */
  id: string;
  /** Human-readable seed statement (hotspot title / card first line / the query). */
  thesis: string;
  /** Lowercased, dedup, stopword-filtered tokens used for overlap matching. */
  keywords: string[];
  /** Seed's canonical url, excluded from its own candidates. */
  url?: string;
  /** Seed's host (www-stripped); a same-host candidate is a likely follow-up. */
  host?: string;
}

/** A gathered candidate with its rule signals, before (optional) agent refinement. */
export interface Candidate {
  hotspot: Hotspot;
  overlap: number;
  sameHost: boolean;
  ruleConfidence: number;
}

export interface ExistingCorpus {
  ids: Set<string>;
  /** Normalized urls already present, so we don't re-gather a manually-added link. */
  urls: Set<string>;
}

export interface GatherOpts {
  minOverlap?: number;
  maxCandidates?: number;
  perHostCap?: number;
}

/** One agent verdict, index-aligned to the candidate it refines (0-based position in the input array). */
export interface AgentVerdict {
  index: number;
  klass: CardClass;
  stance: CardStance;
  confidence: number;
  note: string;
}

export interface AgentClassifier {
  /** Refine the rule labels with semantic judgment. Returns one verdict per (refined) candidate, or
   *  undefined when the agent is unavailable / its output couldn't be parsed → caller uses rule labels. */
  classify(seed: Seed, candidates: Candidate[]): Promise<AgentVerdict[] | undefined>;
}

/** Tokenize for overlap: ASCII words (≥3 chars, non-stopword) + maximal CJK runs (≥2 chars, covering
 *  CJK Ext A + the Unified Ideographs block). Lowercased and deduped. CJK is matched as whole runs (no
 *  word segmenter) — adequate for substring overlap. The regex is a flat char-class (ReDoS-safe). */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const out = new Set<string>();
  for (const m of lower.matchAll(/[a-z0-9]{3,}|[㐀-鿿]{2,}/g)) {
    const t = m[0];
    if (!STOPWORDS.has(t)) out.add(t);
  }
  return [...out];
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/** Stable identity for dedup: protocol + lowercased host + path (no trailing slash) + query, hash dropped. */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    const path = u.pathname.replace(/\/$/, '');
    return `${u.protocol}//${u.hostname.toLowerCase()}${path}${u.search}`;
  } catch {
    return url;
  }
}

function overlapCount(keywords: string[], text: string): number {
  if (keywords.length === 0) return 0;
  const hay = text.toLowerCase();
  let n = 0;
  for (const k of keywords) if (hay.includes(k)) n += 1;
  return n;
}

function ruleConfidence(seed: Seed, h: Hotspot, overlap: number, sameHost: boolean): number {
  const overlapRatio = seed.keywords.length > 0 ? overlap / seed.keywords.length : 0;
  const score = typeof h.score === 'number' && Number.isFinite(h.score) ? Math.min(1, Math.max(0, h.score)) : 0.3;
  const blend = 0.6 * Math.min(1, overlapRatio) + 0.3 * score + (sameHost ? 0.1 : 0);
  return Math.min(1, Math.max(0, blend));
}

export function seedFromHotspot(h: Hotspot): Seed {
  const host = hostOf(h.url);
  return {
    id: h.id,
    thesis: h.title,
    keywords: tokenize(`${h.title} ${h.excerpt ?? ''}`),
    url: h.url,
    ...(host ? { host } : {}),
  };
}

function cardText(card: MaterialCard): string {
  switch (card.kind) {
    case 'link':
      return `${card.content.title ?? ''} ${card.content.excerpt}`.trim();
    case 'md':
    case 'text':
      return card.content.body;
    case 'code':
      return card.content.snippet;
    case 'image':
      return card.content.alt;
    default:
      return '';
  }
}

export function seedFromCard(card: MaterialCard): Seed | undefined {
  const text = `${card.source?.title ?? ''} ${cardText(card)}`.trim();
  if (!text) return undefined;
  const url = card.kind === 'link' ? card.content.url : card.source?.url;
  const host = url ? hostOf(url) : undefined;
  const thesis = (card.source?.title ?? text).split(/\r?\n/)[0]?.slice(0, 200) ?? text.slice(0, 200);
  return {
    id: card.id,
    thesis,
    keywords: tokenize(text),
    ...(url ? { url } : {}),
    ...(host ? { host } : {}),
  };
}

const QUERY_MAX = 200;

export function seedFromQuery(query: string): Seed | undefined {
  const q = query.trim().slice(0, QUERY_MAX); // bound the work before tokenizing untrusted input
  if (!q) return undefined;
  return { id: '', thesis: q, keywords: tokenize(q) };
}

export function existingFromCards(cards: MaterialCard[]): ExistingCorpus {
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const c of cards) {
    ids.add(c.id);
    const u = c.kind === 'link' ? c.content.url : c.source?.url;
    if (u) urls.add(normalizeUrl(u));
  }
  return { ids, urls };
}

/** Tier A: rank the snapshot's hotspots by keyword overlap with the seed, drop the seed/dupes/unfetchable,
 *  then apply a per-host cap and an overall budget. Deterministic (no Date/random). Pure (no mutation of
 *  the input array). */
export function gatherCandidates(
  seed: Seed,
  hotspots: Hotspot[],
  existing: ExistingCorpus,
  opts: GatherOpts = {},
): Candidate[] {
  const minOverlap = opts.minOverlap ?? DEFAULT_MIN_OVERLAP;
  const maxCandidates = opts.maxCandidates ?? MAX_INQUIRY;
  const perHostCap = opts.perHostCap ?? PER_HOST_CAP;
  const seedUrl = seed.url ? normalizeUrl(seed.url) : undefined;

  const scored: Candidate[] = [];
  for (const h of hotspots) {
    if (!h || typeof h.id !== 'string' || typeof h.url !== 'string') continue;
    if (seed.id && h.id === seed.id) continue;
    if (existing.ids.has(`hs_${h.id}`)) continue;
    if (!isFetchableUrl(h.url)) continue;
    const nu = normalizeUrl(h.url);
    if (seedUrl && nu === seedUrl) continue;
    if (existing.urls.has(nu)) continue;
    const overlap = overlapCount(seed.keywords, `${h.title} ${h.excerpt ?? ''}`);
    if (overlap < minOverlap) continue;
    const sameHost = !!seed.host && hostOf(h.url) === seed.host;
    scored.push({ hotspot: h, overlap, sameHost, ruleConfidence: ruleConfidence(seed, h, overlap, sameHost) });
  }

  scored.sort(
    (a, b) =>
      b.overlap - a.overlap ||
      (b.hotspot.score ?? 0) - (a.hotspot.score ?? 0) ||
      (a.hotspot.id < b.hotspot.id ? -1 : a.hotspot.id > b.hotspot.id ? 1 : 0),
  );

  const seenUrls = new Set<string>();
  const hostCount = new Map<string, number>();
  const out: Candidate[] = [];
  for (const c of scored) {
    if (out.length >= maxCandidates) break;
    const nu = normalizeUrl(c.hotspot.url);
    if (seenUrls.has(nu)) continue;
    const host = hostOf(c.hotspot.url) ?? '';
    const used = hostCount.get(host) ?? 0;
    if (used >= perHostCap) continue;
    seenUrls.add(nu);
    hostCount.set(host, used + 1);
    out.push(c);
  }
  return out;
}

/** The rule tier can't tell corroborate from contradict — every gathered candidate is a neutral 补充. */
export function ruleLabel(c: Candidate): EvidenceLabel {
  return { klass: '补充', confidence: c.ruleConfidence, stance: 'neutral' };
}

export interface InquiryInput {
  seed: Seed;
  hotspots: Hotspot[];
  existing: ExistingCorpus;
  classifier?: AgentClassifier;
  gather?: GatherOpts;
  deps?: NormalizeDeps;
}

export interface InquiryResult {
  cards: CardLink[];
  /** True when ≥1 verdict came from the agent tier. May be PARTIAL — some cards can still carry rule
   *  labels (compare candidateCount with how many verdicts the agent returned). */
  usedAgent: boolean;
  candidateCount: number;
}

/** Orchestrate one 询证 run: gather (Tier A) → optionally refine with the injected classifier (Tier B,
 *  graceful) → shape evidence cards. The route persists the cards; this stays IO-free (deps inject time/id). */
export async function runInquiry(input: InquiryInput): Promise<InquiryResult> {
  const candidates = gatherCandidates(input.seed, input.hotspots, input.existing, input.gather);

  let verdicts: AgentVerdict[] | undefined;
  if (input.classifier && candidates.length > 0) {
    try {
      verdicts = await input.classifier.classify(input.seed, candidates);
    } catch {
      verdicts = undefined; // agent failure → fall back to rule labels (never throw the whole run)
    }
  }
  const byIndex = new Map<number, AgentVerdict>();
  for (const v of verdicts ?? []) {
    if (v && Number.isInteger(v.index)) byIndex.set(v.index, v);
  }

  const cards: CardLink[] = [];
  candidates.forEach((c, i) => {
    const v = byIndex.get(i);
    const label: EvidenceLabel = v
      ? { klass: v.klass, confidence: v.confidence, stance: v.stance, note: v.note }
      : ruleLabel(c);
    const card = evidenceCard(c.hotspot, input.seed.id, label, input.deps);
    if (card) cards.push(card);
  });

  return { cards, usedAgent: byIndex.size > 0, candidateCount: candidates.length };
}
