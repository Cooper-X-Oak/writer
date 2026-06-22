// Write — drive the user's local coding-agent CLI to draft an article from a topic, streamed to
// the web over SSE. Internal API surface → plain TS interfaces (PLAN.md §2.4).

import type { SourceType } from './collect.js';

/** Provenance carried from a selected hotspot into the new project (recorded in its manifest).
 *  Absent for manually-typed topics. */
export interface WriteSource {
  hotspotId: string;
  sourceType: SourceType;
  /** Canonical http(s) URL of the originating item. */
  url: string;
  /** ISO-8601 — when the hotspot was collected. */
  collectedAt: string;
}

export interface WriteRequest {
  /** The hotspot/topic to write about. */
  topic: string;
  /** Set when the topic was seeded from a collected hotspot. */
  source?: WriteSource;
  /** Write INTO this existing project (a corpus → draft transition) instead of creating a new one. */
  projectId?: string;
}

// Wire events for the POST /api/agent/write SSE stream. Deliberately decoupled from the daemon's
// internal ClaudeStreamEvent so the web never depends on agent-runtime internals.
export type WriteStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'delta'; text: string }
  // projectId is set when the finished draft was persisted as a project; absent if saving failed.
  | { type: 'done'; costUsd?: number; projectId?: string }
  | { type: 'error'; message: string };
