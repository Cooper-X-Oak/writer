// corpus.ts — 资料区 (material corpus) cards. Internal API surface → plain TS interfaces (PLAN §2.4).
// Tolerant validation of UNTRUSTED ingest (dropped material, hand-edited materials.json) lives in
// the daemon corpus layer, NOT here. Mirrors collect.ts:1-2.

export type CardKind = 'link' | 'image' | 'md' | 'text' | 'code';
export type CardOrigin = 'auto' | 'manual'; // auto = 询证 (W2); manual = human drop (W1)
export type CardClass = '原始' | '补充' | '对比'; // shown verbatim in the UI

/** Bibliographic provenance, orthogonal to content. Present on auto cards, optional on manual. */
export interface CardSource {
  /** Canonical http(s) URL — re-validated with isFetchableUrl on ingest and on read. */
  url?: string;
  title?: string;
  author?: string;
  /** ISO-8601 publish date, or absent. */
  date?: string;
}

interface CardBase {
  /** Stable id. Manual: time-sortable createProjectId. Auto: 'hs_' + Hotspot.id. */
  id: string;
  kind: CardKind;
  origin: CardOrigin;
  klass: CardClass;
  source?: CardSource;
  /** 0..1 — score-derived for auto, 1 for manual. */
  confidence: number;
  tags: string[];
  note: string;
  /** ISO-8601 — when we added it to the corpus. */
  addedAt: string;
}

export interface CardLink extends CardBase {
  kind: 'link';
  content: { url: string; excerpt: string; title?: string };
}
export interface CardImage extends CardBase {
  kind: 'image';
  /** filename = sha256-named file under the project's materials-images/ dir. */
  content: { filename: string; alt: string; contentType: string; width?: number; height?: number };
}
export interface CardMd extends CardBase {
  kind: 'md';
  content: { body: string };
}
export interface CardText extends CardBase {
  kind: 'text';
  content: { body: string };
}
export interface CardCode extends CardBase {
  kind: 'code';
  content: { snippet: string; language?: string };
}

export type MaterialCard = CardLink | CardImage | CardMd | CardText | CardCode;

/** GET /api/projects/:id/materials envelope (mirrors FeedsResponse / HotspotSnapshot). */
export interface CorpusResponse {
  cards: MaterialCard[];
}
