// inbox.ts — the GLOBAL planning-desk inbox (策划台收件箱). Project-independent staging: clip raw
// material before committing to a piece, then promote into a project's corpus. An inbox item IS a
// MaterialCard (same DTO as the per-project corpus); the inbox is just an un-homed list of them.
// Mirrors CorpusResponse (corpus.ts).

import type { MaterialCard } from './corpus.js';

/** GET /api/inbox envelope. */
export interface InboxResponse {
  items: MaterialCard[];
}

/** POST /api/projects/:id/materials/promote response — which inbox items moved into the project. */
export interface PromoteResponse {
  promoted: MaterialCard[];
  skipped: string[];
}
