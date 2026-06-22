// Pure, deterministic rule scorer + budget cap — the cheap prefilter that ranks collected hotspots
// before any model/network work. NO Date.now / new Date(): all time comes from opts.now (ms epoch).
// Quality is an ADDITIVE blend of three factors in [0,1], then SCALED by a multiplicative per-source
// trust weight, so one missing signal degrades gracefully and an unknown source (weight 0) is cleanly
// excluded. No I/O, no module-level mutable state, no array mutation of the caller's input.

import type { ProvenanceNode, ScoreOpts, ScoreWeights } from './types.js';
import type { SourceType } from '@app/contracts';

export const HALF_LIFE_DEFAULT = 12; // hours
export const COMP_W_DEFAULT: ScoreWeights = { recency: 0.5, engagement: 0.3, keyword: 0.2 };
export const ENGAGEMENT_LOG_CAP = 6; // ln(1+raw)/6 saturates ~raw=402; bounds a viral post
export const NEUTRAL = 0.5; // missing/absent signal → neutral, never a penalty-to-zero

const MS_PER_HOUR = 3_600_000;

/** Parse an ISO date to ms; unparseable/null → 0, never NaN/throw. Used for tie-breaking, where a
 *  missing date sorts as oldest (deterministic) — distinct from how recencyFactor treats it. */
function parseMs(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Exponential half-life decay on age from publishedAt; future/skewed dates clamp to 1.0. A MISSING
 *  or unparseable date is a missing signal → NEUTRAL (consistent with engagement/keyword), so an
 *  undated item is not buried at the bottom by a zeroed recency. (0,1]. */
function recencyFactor(node: ProvenanceNode, opts: ScoreOpts): number {
  const ms = parseMs(node.publishedAt);
  if (ms === 0) return NEUTRAL; // no date / unparseable → neutral, not "oldest"
  const halfLife = opts.halfLifeHours ?? HALF_LIFE_DEFAULT;
  const ageHours = Math.max(0, (opts.now - ms) / MS_PER_HOUR);
  return Math.pow(0.5, ageHours / halfLife);
}

/** Multiplicative trust prior; unknown source → 0 (excluded). */
function sourceFactor(node: ProvenanceNode, opts: ScoreOpts): number {
  return opts.sourceWeights[node.sourceType] ?? 0;
}

/** HN: blend points + 2×comments (discussion weighted higher), log-compressed & clamped. RSS: neutral. */
function engagementFactor(node: ProvenanceNode): number {
  if (node.sourceType !== 'hn') return NEUTRAL;
  const points = Math.max(0, node.points ?? 0);
  const comments = Math.max(0, node.commentCount ?? 0);
  const raw = points + 2 * comments;
  return Math.min(1, Math.log1p(raw) / ENGAGEMENT_LOG_CAP);
}

/** Optional substring keyword boost over title+excerpt. Off (neutral) when no keywords configured. */
function keywordFactor(node: ProvenanceNode, opts: ScoreOpts): number {
  const kws = opts.keywords;
  if (!kws || kws.length === 0) return NEUTRAL;
  const hay = `${node.title} ${node.excerpt}`.toLowerCase();
  const hits = kws.filter((k) => k.length > 0 && hay.includes(k.toLowerCase())).length;
  if (hits === 0) return NEUTRAL * 0.6; // mild demote (0.3), never zero
  return Math.min(1, NEUTRAL + 0.25 * hits);
}

/** Deterministic rule score in [0, max(sourceWeight)]. */
export function score(node: ProvenanceNode, opts: ScoreOpts): number {
  const w = opts.weights ?? COMP_W_DEFAULT;
  const quality =
    w.recency * recencyFactor(node, opts) +
    w.engagement * engagementFactor(node) +
    w.keyword * keywordFactor(node, opts);
  return sourceFactor(node, opts) * quality;
}

export interface BudgetCap {
  topN?: number;
  perSourceCap?: number;
}

const DEFAULT_TOP_N = 20;
const DEFAULT_PER_SOURCE_CAP = 10;

/** Score every node, sort desc with explicit tie-breaks (deterministic), then apply a per-source cap
 *  and an overall topN cap. Pure: does NOT mutate the input array. */
export function selectTopHotspots(
  nodes: ProvenanceNode[],
  opts: ScoreOpts,
  cap: BudgetCap = {},
): { node: ProvenanceNode; score: number }[] {
  const topN = cap.topN ?? DEFAULT_TOP_N;
  const perSourceCap = cap.perSourceCap ?? DEFAULT_PER_SOURCE_CAP;

  const scored = nodes.map((node) => ({ node, score: score(node, opts) }));
  // Sort a COPY-derived array; stable tie-break: score desc → publishedAt desc → key asc.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = parseMs(a.node.publishedAt);
    const pb = parseMs(b.node.publishedAt);
    if (pb !== pa) return pb - pa;
    return a.node.key < b.node.key ? -1 : a.node.key > b.node.key ? 1 : 0;
  });

  const perSource = new Map<SourceType, number>();
  const out: { node: ProvenanceNode; score: number }[] = [];
  for (const entry of scored) {
    if (out.length >= topN) break;
    if (entry.score <= 0) continue; // unknown/excluded source
    const used = perSource.get(entry.node.sourceType) ?? 0;
    if (used >= perSourceCap) continue;
    perSource.set(entry.node.sourceType, used + 1);
    out.push(entry);
  }
  return out;
}
