// Sidecar manifest — the per-project descriptor written as manifest.json. Its presence is the
// commit marker: a project dir without a readable manifest is treated as incomplete and skipped.

import type { Project, ProjectStage, WriteSource } from '@app/contracts';
import { ARTIFACT_FILE } from './paths.js';
import { parseWriteSource } from './provenance.js';

const STAGES = new Set<ProjectStage>(['corpus', 'outline', 'draft']);

export interface ProjectManifest {
  id: string;
  title: string;
  topic: string;
  /** ISO-8601. */
  createdAt: string;
  kind: 'article';
  renderer: 'html';
  /** Entry artifact filename, relative to the project dir. */
  entry: string;
  /** Lifecycle stage. A 'corpus' project has no body/article yet (just a material corpus). */
  stage: ProjectStage;
  /** Where this draft originated, when seeded from a hotspot. Absent for manually-typed topics. */
  source?: WriteSource;
}

export function buildManifest(input: {
  id: string;
  title: string;
  topic: string;
  createdAt: string;
  stage?: ProjectStage;
  source?: WriteSource;
}): ProjectManifest {
  return {
    id: input.id,
    title: input.title,
    topic: input.topic,
    createdAt: input.createdAt,
    kind: 'article',
    renderer: 'html',
    entry: ARTIFACT_FILE,
    stage: input.stage ?? 'draft',
    ...(input.source ? { source: input.source } : {}),
  };
}

export function manifestToProject(m: ProjectManifest, dir: string): Project {
  return { id: m.id, dir, title: m.title, createdAt: m.createdAt, stage: m.stage, ...(m.source ? { source: m.source } : {}) };
}

/** Tolerant parse: return undefined (not throw) on malformed/partial JSON so listing skips junk. */
export function parseManifest(json: string): ProjectManifest | undefined {
  let o: Partial<ProjectManifest>;
  try {
    o = JSON.parse(json) as Partial<ProjectManifest>;
  } catch {
    return undefined;
  }
  if (
    typeof o.id !== 'string' ||
    typeof o.title !== 'string' ||
    typeof o.createdAt !== 'string' ||
    typeof o.entry !== 'string'
  ) {
    return undefined;
  }
  const source = parseWriteSource(o.source); // carried forward only when shape-valid (else omitted)
  // Legacy manifests predate `stage`; a project with an article is a finished draft.
  const stage: ProjectStage = STAGES.has(o.stage as ProjectStage) ? (o.stage as ProjectStage) : 'draft';
  return {
    id: o.id,
    title: o.title,
    topic: typeof o.topic === 'string' ? o.topic : o.title,
    createdAt: o.createdAt,
    kind: 'article',
    renderer: 'html',
    entry: o.entry,
    stage,
    ...(source ? { source } : {}),
  };
}
