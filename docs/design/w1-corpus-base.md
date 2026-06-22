# W1 资料区基座 — Implementation Design (per-project)

> Reconciled from a 4-facet design workflow + adversarial critique, against the real codebase.
> Scope/acceptance: `PLAN.md` §"Phase 2" (W1). Direction: [ADR-0001](../adr/0001-evidence-grounded-writing.md).
> **Owner decision (overrides the workflow's "global" default): the corpus is per-project** — a
> Project starts life as a corpus. This is the single source of truth for W1.

---

## 1. Scope + acceptance

**Scope:** the material-card model (`link|image|md|text|code`), a **per-project** 资料区 store, the
资料区 UI, manual drop → normalize → card, and the provenance→card seam (「＋ 加入资料区」).

**Acceptance:** *open/create a corpus project, drop a link / text / image → a persisted card appears
in its 资料区 (survives reload).*

**Out of W1:** 询证 auto-fan-out + classify 原/补/对 (W2) · 资料区→AI outline + node↔card map (W3) ·
cited draft / citation sidebar (W4–W5) · outbound link-body fetch · auto-minting a card per hotspot.

---

## 2. Resolved key decisions

| # | Decision | Choice + rationale |
|---|----------|--------------------|
| D1 | **Does a Project start life as a corpus?** | **YES (owner).** `ProjectManifest` gains `stage: 'corpus' \| 'outline' \| 'draft'`. A new corpus project is manifest-only (no body/article); materials live in a per-project `materials.json`. Rationale: cards must live where the article will live, so W3–W5 (outline, node↔card map, citation block⇄card) never migrate cards across an entity boundary or break the card-id stability citations depend on. |
| D2 | **Backward compat for `stage`** | `parseManifest` defaults **absent `stage` → `'draft'`** (every existing project was created with a body+article, i.e. a finished draft). Only the new corpus path writes `stage:'corpus'`. No migration of old projects. |
| D3 | **Creating a corpus project** | New `store.createCorpus({title?})` writes **manifest only** (`stage:'corpus'`, empty title default "未命名资料区", `topic:''`), no `body.md`/`article.html`. Relaxes "manifest = committed" to "manifest = committed; body/article exist iff stage≠corpus". New route `POST /api/projects/corpus`. |
| D4 | **Card TS shape + location** | Discriminated union `MaterialCard` keyed on `kind` in new `packages/contracts/src/api/corpus.ts`, re-exported from `index.ts`. Interfaces here; tolerant validation in the daemon (`collect.ts:1-2` precedent; `index.ts:1` "only shared surface"). |
| D5 | **Naming / vocab** | `klass` (`class` reserved) typed `'原始'\|'补充'\|'对比'` (domain chips, verbatim). `kind`/`origin` English machine tokens (`collect.ts:4` precedent: `'hn'\|'rss'`). |
| D6 | **Per-kind `content`, orthogonal to `source`** | `link→{url,excerpt,title?}` · `image→{filename,alt,contentType,w?,h?}` · `md/text→{body}` · `code→{snippet,language?}`. ADR-0001 separates source (bibliographic) from content. |
| D7 | **Hotspot → card** | **COEXIST** via pure one-way `hotspotToCard(h)` behind a per-hotspot 「＋ 加入资料区」. W1 does NOT touch `hotspots.json`, `WriteSource`, or fold the two stores. Deterministic `id:'hs_'+h.id` → **idempotent** (see D9). |
| D8 | **Link cards: fetch or paste?** | **Paste-only** in W1, zero outbound fetch (minimal SSRF surface). Auto-enrich is W2 via `safeFetch` (`fetch-util.ts:132`). |
| D9 | **`addMaterial` upsert, not append** | `addMaterial` **upserts by `id`** (replace if present, else append) so re-clicking 「加入资料区」 on the same hotspot (`hs_<id>`) does not duplicate. (Critique B2.) |
| D10 | **UI placement** | 资料区 is a **persistent right rail** rendered unconditionally — delete the `{!selected && (…)}` gate at `write-studio.tsx:525` (the audit root cause). It shows the **open project's** materials; a `corpus`-stage project's main pane shows a "加素材 → 下一步生成大纲 (W3)" placeholder instead of an article. Hotspots fold in as a feeder section (`hotspot-sidebar.tsx:14` children). |
| D11 | **Caps** | `MAX_CARDS` per project (analogous to `MAX_FEEDS=16`, `feed-normalize.ts:8`); per-card body cap on `md/text/code`; `MAX_IMAGE_BYTES` on image upload. Reject over-cap with 400. |

---

## 3. Data model — `packages/contracts/src/api/corpus.ts` (NEW)

```ts
// corpus.ts — 资料区 material cards. Internal API surface → plain TS interfaces (PLAN §2.4).
// Tolerant validation of UNTRUSTED ingest (dropped material, hand-edited materials.json) lives in
// the daemon corpus layer, NOT here. Mirrors collect.ts:1-2.

export type CardKind = 'link' | 'image' | 'md' | 'text' | 'code';
export type CardOrigin = 'auto' | 'manual';       // auto = 询证 (W2); manual = human drop (W1)
export type CardClass = '原始' | '补充' | '对比';  // shown verbatim in the UI

/** Bibliographic provenance, orthogonal to content. */
export interface CardSource { url?: string; title?: string; author?: string; date?: string }

interface CardBase {
  id: string;                 // manual: time-sortable createProjectId; auto: 'hs_' + Hotspot.id
  kind: CardKind;
  origin: CardOrigin;
  klass: CardClass;
  source?: CardSource;
  confidence: number;         // 0..1 — score-derived for auto, 1 for manual
  tags: string[];
  note: string;
  addedAt: string;            // ISO-8601, when WE added it
}
export interface CardLink  extends CardBase { kind: 'link';  content: { url: string; excerpt: string; title?: string } }
export interface CardImage extends CardBase { kind: 'image'; content: { filename: string; alt: string; contentType: string; width?: number; height?: number } }
export interface CardMd    extends CardBase { kind: 'md';    content: { body: string } }
export interface CardText  extends CardBase { kind: 'text';  content: { body: string } }
export interface CardCode  extends CardBase { kind: 'code';  content: { snippet: string; language?: string } }

export type MaterialCard = CardLink | CardImage | CardMd | CardText | CardCode;
export interface CorpusResponse { cards: MaterialCard[] }   // GET envelope, mirrors FeedsResponse
```

Re-export the corpus types from `index.ts` beside the `collect.ts` line.

### 3.1 Per-format normalization (manual drop → card)

| Input | kind | content | reuse |
|-------|------|---------|-------|
| URL paste | `link` | `{ url, excerpt: cleanExcerpt(userExcerpt ?? ''), title? }`; reject unless `isFetchableUrl(url)` | `cleanExcerpt` `html.ts:64`; `isFetchableUrl` `fetch-util.ts:96` |
| plaintext / selection | `text` | `{ body }` (raw, capped) | — |
| markdown file/paste | `md` | `{ body }` | — |
| code paste | `code` | `{ snippet, language?: lowercase }` | — |
| image file / clipboard blob | `image` | `{ filename, alt, contentType }` (blob written first) | sha256 + `IMAGE_TYPE_BY_EXT` `store.ts:38-50,298` |

Shared manual defaults: `origin:'manual'`, `klass:'原始'` (reclassified in W3), `confidence:1`,
`tags:[]`, `note:''`, `addedAt=now()`, `id=createProjectId()` (`paths.ts:73`).

`hotspotToCard(h)`: `origin:'auto'`, `kind:'link'`, `klass:'原始'`, `id:'hs_'+h.id`,
`source:{url:h.url,title:h.title,author:h.author,date:h.publishedAt??undefined}`,
`content:{url:h.url,excerpt:h.excerpt}`, `confidence:` clamp(`h.score`), `addedAt:now()`.

---

## 4. Storage (per-project)

### 4.1 Layout — under the existing project dir (`projectDir(root,id)`, `paths.ts`)

```
<dataDir>/projects/<id>/
├── manifest.json          (EDIT: + "stage")
├── body.md, article.html  (absent while stage='corpus')
├── materials.json         ← NEW: { cards: MaterialCard[] }
└── materials-images/       ← NEW: sha256-named image bytes
```

### 4.2 `paths.ts` (EDIT) — beside the artifact/body helpers

```ts
export const MATERIALS_FILE = 'materials.json';
export const MATERIALS_IMAGES_DIR = 'materials-images';
export function materialsPath(dir: string): string { return join(dir, MATERIALS_FILE); }
export function materialsImagesDir(dir: string): string { return join(dir, MATERIALS_IMAGES_DIR); }
```
`dir` is always a `projectDir(root, isSafeProjectId-checked id)` — no new path-safety surface.
Served image filenames pass `isSafeImageName` (`paths.ts:67`) verbatim.

### 4.3 `manifest.ts` (EDIT)

- `ProjectManifest` gains `stage: 'corpus' | 'outline' | 'draft'`.
- `buildManifest` accepts `stage` (default `'draft'`).
- `parseManifest`: `stage = STAGES.has(o.stage) ? o.stage : 'draft'` (D2 backward compat).
- `manifestToProject` forwards `stage` onto the `Project` DTO (so the web can show it / pick the pane).
  → also add `stage` to the `Project` contract (`project.ts`).

### 4.4 Store — materials live in `apps/daemon/src/corpus/materials-store.ts` (NEW), delegated from `ProjectStore`

Keep `workspace/store.ts` under the 800-line rule: a `createMaterialsStore({ root, genId?, now? })`
module with methods that take a **project id** and guard `isSafeProjectId` first:

```ts
list(projectId): Promise<MaterialCard[]>                          // tolerant read + re-validate
addCard(projectId, card): Promise<MaterialCard | undefined>       // UPSERT by id (D9)
addImage(projectId, bytes, contentType, alt): Promise<MaterialCard | undefined>
readImage(projectId, filename): Promise<{bytes,contentType} | undefined>
remove(projectId, cardId): Promise<{id} | undefined>
```
`ProjectStore` gains `createCorpus({title?})` (D3) and forwards the material methods (or the router
holds the materials store directly with the same `root`).

### 4.5 Commit discipline (generalizes body→artifact→manifest-LAST)

- **JSON drops** (link/text/md/code): build card (pure) → upsert → `atomicWrite(materialsPath)` (temp+rename, `store.ts:107-116`).
- **Image drops**: write the sha256 blob FIRST via `atomicWriteBuffer` into `materials-images/`, THEN write `materials.json` LAST. Crash → at worst a GC-able orphan blob, never a card → missing file.
- Immutable transforms (spread + new array).
- **Read-time re-validation mandatory:** `list()` re-parses + drops malformed + re-checks link/source `isFetchableUrl` — `materials.json` is hand-editable/untrusted, exactly as `parseFeedList` re-normalizes (`feeds-store.ts:39-52`).
- Image `remove` does NOT delete the blob in W1 (content-addressed; orphans GC-able).

### 4.6 Tolerant parser — `apps/daemon/src/corpus/parse.ts` (NEW)

Mirrors `parseManifest` (`manifest.ts:46-72`) / `parseWriteSource` (`provenance.ts:10-25`): typeof
guards, return `undefined` (never throw), per-element drop.

```ts
export function parseCard(raw): MaterialCard | undefined;   // one card → validated or drop
export function parseCards(json): MaterialCard[];           // []-on-bad-JSON; drops malformed
```
Per-kind: `id` non-empty; `kind∈KINDS`; `origin∈{auto,manual}`; `klass∈CLASSES`; `addedAt` string;
clamp `confidence` to [0,1]; coerce `tags`/`note`. **SSRF:** re-check **`isFetchableUrl`
(`fetch-util.ts:96` — the real loopback/private/metadata guard; NOT `provenance.ts` which is
scheme-only)** on `link.content.url` (drop the whole `link` card on fail — a link has no meaning
without a url) and on `source.url` (drop only `source` for non-link cards). `image.filename` passes
`isSafeImageName`; `contentType` in the allowlist (no SVG).

---

## 5. Ingest — routes (`apps/daemon/src/api/corpus.ts`, NEW; mounted after `server.ts:41`)

All material routes are **per-project**, following the `projects.ts` conventions (id-narrow, typeof
validation, `.then/.catch`, bare envelope, loopback-CORS + JSON-preflight CSRF, `undefined`→404):

| Method + path | Body | Returns | Reuse |
|---|---|---|---|
| `POST /projects/corpus` | `{ title? }` | `{ project }` (stage corpus) | `store.create` shape `projects.ts` |
| `GET /projects/:id/materials` | — | `{ cards }` | envelope `feeds.ts:22-27` |
| `POST /projects/:id/materials` | `{ kind, ... }` (link/text/md/code) | `{ card }` | JSON drop + 400-on-bad-url `feeds.ts:29-45` |
| `POST /projects/:id/materials/image` | raw bytes, `Content-Type: image/*`, `?alt=` | `{ card }` | `express.raw({type:()=>true,limit:MAX_IMAGE_BYTES})` `projects.ts:122-145` |
| `POST /projects/:id/materials/from-hotspot` | `{ hotspotId }` | `{ card }` | `hotspotStore.read()` → `.find(h=>h.id===hotspotId)` → `hotspotToCard` (G1) |
| `DELETE /projects/:id/materials/:cardId` | — | `204` | 404-map `projects.ts:149-161`; cardId keys JSON, no path guard |
| `GET /projects/:id/materials/images/:name` | — | bytes + type | `readImage` + `isSafeImageName` `projects.ts:180-193` |

- Injectable `{ store?, hotspotStore? }` → routes unit-test offline (`feeds.ts:14-19`).
- Image route: client **MUST** send `Content-Type: image/*` (not JSON) or the global `express.json`
  (`server.ts:30`) swallows the bytes — same as the proven `projects.ts:122` image route (G4).
- Allowlist via `IMAGE_TYPE_BY_EXT` (`store.ts:38-50`) — **no SVG** (XSS). Reject with 400/404.

---

## 6. UI

### 6.1 Placement (load-bearing change)
Delete the `{!selected && (…)}` gate at `write-studio.tsx:525-540`; render `<CorpusSidebar>`
**unconditionally** in the right slot, fed the **open project's** materials. Hotspot rail becomes a
feeder section inside it (HotspotSidebar `children`, `hotspot-sidebar.tsx:14`), each hotspot gaining
「＋ 加入资料区」 → `POST /projects/:id/materials/from-hotspot`. `styles.layout` unchanged.

### 6.2 Corpus-stage main pane
When `selected.stage === 'corpus'`, the main pane shows a placeholder ("这是一篇资料区。拖/贴素材到右侧，
攒够了下一步生成大纲（W3）") instead of `ArticleView`. ＋ 新建资料区 button → `POST /projects/corpus`
→ open it. `ProjectSidebar` shows a small stage chip (资料/大纲/草稿).

### 6.3 New components
- **`material-card.tsx`** — one component, kind-switch body + shared chrome (origin chip, `klass` chip greyed, tags, ✕ `stopPropagation`). Lifts badge + `WebkitLineClamp:2` (`hotspot-sidebar.tsx:99-113`); link cards use `hostnameOf`/`sourceLabel` (`lib/format/provenance.ts`); image cards use `materialImageBase(projectId)+filename`.
- **`corpus-drop-zone.tsx`** — one multi-modal target: drag-drop (`dataTransfer`→file/url/text), `onPaste`, hidden `<input type=file>` behind 「＋ 文件」, and a paste-URL/paste-text row reusing `looksFetchable` (`feed-manager.tsx:13-50`). Dragover highlight via `transform`/`opacity`. Optimistic-prepend then reconcile (`write-studio.tsx:188-195`).
- **`corpus-sidebar.tsx`** — `<aside>` cloning the 260px rail (`hotspot-sidebar.tsx:69`); presentational, studio owns state+API (FeedManager discipline). Renders heading + `CorpusDropZone` + card list + collapsible 热点来源 feeder.

### 6.4 web client `lib/api/corpus.ts` (NEW) + `write-studio.tsx` (EDIT)
Thin fetchers in the `hotspots.ts`/`feeds.ts` shape: `listMaterials(projectId)`, `addLinkCard`,
`addTextCard({kind,body,language?})`, `addImageCard(projectId,file)`, `addHotspotCard(projectId,hotspotId)`,
`removeCard(projectId,id)`, `materialImageBase(projectId)`, `createCorpusProject({title?})`.
write-studio: add `cards`/`corpusBusy` state + `loadCorpus(projectId)` (mirror `loadHotspots` `:80-86`)
+ ingest handlers; corpus-stage pane switch; delete the `:525` gate.

---

## 7. Task breakdown (ordered)

**Contracts**
- [ ] **T1** `contracts/api/corpus.ts` NEW (§3 union). + `project.ts` EDIT: `Project.stage`.
- [ ] **T2** `contracts/index.ts` EDIT — re-export corpus types.

**Daemon**
- [ ] **T3** `workspace/paths.ts` EDIT — `MATERIALS_FILE`/`MATERIALS_IMAGES_DIR` + path helpers.
- [ ] **T4** `workspace/manifest.ts` EDIT — `stage` field; build default `'draft'`; parse default `'draft'`; `manifestToProject` forwards stage. **+ test.**
- [ ] **T5** `corpus/parse.ts` NEW — `parseCard`/`parseCards` (§4.6, SSRF via `fetch-util.ts:96`). **+ test.**
- [ ] **T6** `corpus/normalize.ts` NEW — per-kind builders + `hotspotToCard`. *Reuse* `cleanExcerpt`, `createProjectId`, image discipline. **+ test.**
- [ ] **T7** `corpus/materials-store.ts` NEW — projectId-keyed store, upsert-by-id (D9), blob-first/index-last, read re-validate. *Reuse* `atomicWrite*` `store.ts:107-127`, `feeds-store.ts` skeleton. **+ test (upsert; commit order; bad id rejected).**
- [ ] **T8** `workspace/store.ts` EDIT — `createCorpus({title?})` (manifest-only). **+ test.**
- [ ] **T9** `api/corpus.ts` NEW — per-project router (§5). **+ route test (offline, injected store).**
- [ ] **T10** `server.ts` EDIT — mount corpus router.

**Web**
- [ ] **T11** `lib/api/corpus.ts` NEW (§6.4). **+ client test.**
- [ ] **T12** `components/material-card.tsx` NEW.
- [ ] **T13** `components/corpus-drop-zone.tsx` NEW.
- [ ] **T14** `components/corpus-sidebar.tsx` NEW.
- [ ] **T15** `components/write-studio.tsx` EDIT — corpus state + handlers + corpus-stage pane + delete `:525` gate.

---

## 8. Risks + hardest parts

| Risk | Sev | Mitigation |
|------|-----|------------|
| **SSRF via link/source url** | HIGH | `isFetchableUrl` (`fetch-util.ts:96`, the loopback/metadata guard — **not** scheme-only `provenance.ts`) at BOTH the route AND `parseCard` on read. W1 does no outbound fetch (D8). |
| **Stored XSS in md/code (+ svg)** | HIGH | Store raw, **escape at render** (React text, never `dangerouslySetInnerHTML`); no SVG in the image allowlist. Markdown→HTML rendering deferred + must sanitize (W3/W4). |
| **Image ingest abuse** | MED | `express.raw` + `MAX_IMAGE_BYTES` + content-type allowlist + sha256 name + `isSafeImageName`, verbatim from `projects.ts:122-145` + `store.ts`. |
| **Unbounded materials.json** | LOW | `MAX_CARDS` per project (D11). |

**Hardest parts:** (1) the corpus-stage **project lifecycle** — a project that exists with a manifest
but no body/article (relaxing "manifest=committed"); keep `list()`/open/delete working for it. (2)
multi-modal `CorpusDropZone` format detection (daemon is the validation authority; client routing is
best-effort). (3) read-time SSRF re-validation that drops a bad `link` card but only the `source`
field of a non-link card — get the granularity right or either an SSRF target survives or the corpus
silently empties.
