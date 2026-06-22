// Orchestrates one collection run: run every adapter best-effort (allSettled — a dead source never
// sinks the run), flatten the ProvenanceNodes, score + budget-cap them, and build an immutable
// HotspotSnapshot. Pure given injected deps (fetchImpl, now): no file IO (that's the store).

import { createHash } from 'node:crypto';
import type { CollectConfig, AdapterDeps, ProvenanceNode } from './types.js';
import type { Hotspot, HotspotSnapshot, SourceType } from '@app/contracts';
import { selectTopHotspots } from './score.js';

/** Deterministic, stable, path-safe id for a hotspot. Hashed so a feed-supplied key (guid/url) can
 *  never become a path segment or collide across sources. */
export function hotspotId(sourceType: SourceType, key: string): string {
  return `${sourceType}-${createHash('sha256').update(`${sourceType}:${key}`).digest('hex').slice(0, 16)}`;
}

/** Build an immutable Hotspot from a scored node — a fresh object, never aliasing the node. */
export function nodeToHotspot(node: ProvenanceNode, score: number): Hotspot {
  return {
    id: hotspotId(node.sourceType, node.key),
    sourceType: node.sourceType,
    title: node.title,
    url: node.url,
    excerpt: node.excerpt,
    ...(node.author !== undefined ? { author: node.author } : {}),
    ...(node.points !== undefined ? { points: node.points } : {}),
    ...(node.commentCount !== undefined ? { commentCount: node.commentCount } : {}),
    publishedAt: node.publishedAt,
    fetchedAt: node.fetchedAt,
    score,
  };
}

export async function collectHotspots(config: CollectConfig, deps: AdapterDeps): Promise<HotspotSnapshot> {
  const settled = await Promise.allSettled(config.sources.map((s) => s.collect(deps)));
  const nodes: ProvenanceNode[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') nodes.push(...r.value);
  }

  const selected = selectTopHotspots(nodes, {
    now: deps.now(),
    sourceWeights: config.sourceWeights,
    halfLifeHours: config.halfLifeHours,
    keywords: config.keywords,
  }, { topN: config.topN, perSourceCap: config.perSourceCap });

  const hotspots = selected.map(({ node, score }) => nodeToHotspot(node, score));
  return { collectedAt: new Date(deps.now()).toISOString(), hotspots };
}
