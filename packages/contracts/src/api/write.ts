// Write — drive the user's local coding-agent CLI to draft an article from a topic, streamed to
// the web over SSE. Internal API surface → plain TS interfaces (PLAN.md §2.4).

export interface WriteRequest {
  /** The hotspot/topic to write about. */
  topic: string;
}

// Wire events for the POST /api/agent/write SSE stream. Deliberately decoupled from the daemon's
// internal ClaudeStreamEvent so the web never depends on agent-runtime internals.
export type WriteStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; costUsd?: number }
  | { type: 'error'; message: string };
