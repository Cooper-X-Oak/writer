# Information Architecture — 案台 / Hotspot Writer

A map of the system as built. Legend: **[now]** = shipped (across the A-series stack), **[plan]** =
designed but not yet built (see [ADR-0002](adr/0002-staged-workflow-navigation.md) + PLAN §"Phase 3").
The product is **evidence-grounded writing**: you write by synthesizing a curated, cited corpus of
materials, not from a blank page ([ADR-0001](adr/0001-evidence-grounded-writing.md)).

## 1. System topology

```
┌─ Electron shell ─────────────────────────────────────────────┐
│  BrowserWindow → loadURL(localhost:3000) · offscreen PDF win  │
└──────────────┬───────────────────────────────────────────────┘
               │ loads
┌─ Next.js web (loopback :3000) ───────────────────────────────┐
│  components → view-model hooks → lib/api/* (fetch / SSE)      │
└──────────────┬───────────────────────────────────────────────┘
               │ HTTP / SSE   (loopback-CORS + JSON-preflight CSRF)
┌─ Express daemon (loopback :4319) ────────────────────────────┐
│  /api/* routers → filesystem stores (JSON sidecars + blobs)  │
│  delegates to the local Claude Code CLI (write / rewrite /   │
│  询证 agent tier)                                             │
└──────────────┬───────────────────────────────────────────────┘
               │
        ~/.hotspot-writer/  (or Electron userData; HOTSPOT_DATA_DIR)
```

## 2. State machine / navigation (the IA backbone)

The lifecycle is the persisted `project.stage` field, formalized as an FSM.

```
[now] single route /, driven by stage + `selected`:
  planning (no project · 策划台)
     │ ＋开案卷 (named) → openCase
     ▼
  case ── corpus (案板) ──基于资料写作──▶ draft (手稿) ──export──▶ ⟨exported = derived⟩
            │ ◀── pick another / back to desk
            ▼ planning

[plan] A6 route-as-state (Next nested routes + layouts):
  /                  planning · 策划台 (hub)
  /p/[id]            corpus · 案板
  /p/[id]/outline    outline (W3 seam)
  /p/[id]/write      draft · 手稿
  Stepper: 策划 → 攒料 → 大纲 → 起草 → 导出   (guards: 立大纲 disabled until corpus non-empty)
```

`exported` is intentionally NOT a `ProjectStage` — export is an idempotent action on a `draft`, so
re-editing after export stays legal.

## 3. Screen anatomy (three panes)

```
┌── 案卷 (left) ─┬──────── center (per state) ───────┬──── right rail ────┐
│ ProjectSidebar │ planning → 策划台 intro + 开案卷   │ planning →         │
│ case list      │ corpus  → title + 基于资料写作     │  收件箱 (inbox)     │
│ ＋新建案卷      │ draft   → article + block editing  │ case →             │
│                │          (rewrite/edit/move/       │  资料区 · 案板       │
│                │           insert/delete) + AI image│ + 热点墙 (feeder)   │
│                │           + export                 │ + RSS 订阅源        │
└────────────────┴────────────────────────────────────┴────────────────────┘
[now] left + right rails persistent; center is 3-state. The materials rail switches
variant: 收件箱 (no project) ↔ 资料区 (project).
[plan] A7 makes the planning center a rich 策划台 entry hierarchy (hybrid box + 叙事模板
fan + tabs/search + learn — modeled on claude.ai/design); A8 makes the 案板 center while
gathering and demotes the corpus to a right 来源栏 only when writing.
```

## 4. Component tree [now]

```
app/page.tsx (server shell)
└─ WriteStudio  ('use client' mega-component — A7/A8 split into stage containers)
   ├─ ProjectSidebar          案卷 list
   ├─ center (ternary)
   │   ├─ planning landing    策划台 intro + ＋开案卷
   │   ├─ corpus pane         title / topic input / 基于资料写作 / draft stream
   │   └─ article view        ArticleView + BlockToolbar / RewritePanel /
   │                          EditPanel / ImagePanel / ProvenanceLine
   ├─ CorpusSidebar  variant=corpus | inbox
   │   ├─ CorpusDropZone      drop / paste / file
   │   ├─ MaterialCardView[]  index slip (stock / wax / thread / confidence / 找佐证)
   │   └─ HotspotSidebar      热点墙 (feeder)
   │        └─ FeedManager    RSS 订阅源
   └─ OpenCaseDialog          named 立项
```

## 5. Data layer (hooks → api → daemon)

```
view-model hooks (A4/A5)                lib/api/*               daemon
  useHotspots ─────────────────────────▶ hotspots.ts ──▶ /api/hotspots
  useFeeds ────────────────────────────▶ feeds.ts ─────▶ /api/feeds
  useInbox (global inbox) ─────────────▶ inbox.ts ─────▶ /api/inbox
  openCase / promoteToCase ────────────▶ cases.ts ─────▶ /api/cases · …/promote
  ⟨still in WriteStudio — A4b/A7/A8 ⟩    corpus.ts ────▶ /api/projects/:id/materials · inquiry
    projects / corpus / draft / editing  projects.ts ──▶ /api/projects (list / block ops / export)
                                         write.ts (SSE)▶ /api/agent/write

  server-state (lists, materials) vs client-state (block selection, write stream) are separated.
```

## 6. Daemon API map [now]

```
health / agent   GET  /api/health · /api/agent/detect
writing          POST /api/agent/write (SSE) · /api/agent/rewrite
projects         GET  /api/projects · block edits (patch/insert/delete/move/rename/image)
                 export · DELETE project
discovery        GET  /api/hotspots · refresh · dismiss   |   /api/feeds CRUD
cases / corpus   POST /api/projects/corpus · /api/cases (title-guarded 立项)
                 /api/projects/:id/materials (GET/POST/image/from-hotspot/DELETE/images)
                 …/materials/inquiry (W2 询证) · …/materials/promote (inbox → case)
inbox (global)   GET/POST /api/inbox · /image · /from-hotspot · DELETE · /images
```

## 7. Storage layout (files are the source of truth)

```
~/.hotspot-writer/
├─ hotspots.json        global hotspot snapshot
├─ feeds.json           RSS subscriptions
├─ dismissed.json       dismissed hotspot ids
├─ inbox.json           ★ GLOBAL inbox (project-independent staging)
├─ inbox-images/        inbox image blobs (sha256-named)
└─ projects/<id>/
   ├─ manifest.json     id · title · stage (corpus|outline|draft) · source · createdAt
   ├─ body.md           editable draft (source of truth)
   ├─ article.html      rendered artifact
   ├─ materials.json    ★ this piece's 资料区 (MaterialCard[])
   ├─ materials-images/ material image blobs
   └─ images/           AI illustration files
```

## 8. Material / evidence model (the differentiator)

```
MaterialCard = link | image | md | text | code   (a discriminated union)
 shared: id · origin (auto 询证 / manual 手工) · klass (原始|补充|对比)
         confidence 0..1 · stance (corroborate|contradict|neutral) · relatedTo[] (feeds W3 mapping)
         source{url,title,date} · note (核验) · tags · addedAt

two levels:  GLOBAL inbox (no project) ──promote (拣选)──▶ a piece's 资料区 (案板)
询证 (W2):   seed (card / hotspot / query) → rule-gather candidates from the snapshot
             + (optional) agent classify 原/补/对 → evidence cards (idempotent by id)
```

Security boundary recap: SSRF guarded by `isFetchableUrl` at write AND read time; path safety via
`isSafeProjectId` / `isSafeImageName`; no-SVG image allowlist; stored-XSS prevented by escape-at-render
(React text, never `dangerouslySetInnerHTML`); loopback-CORS + JSON-preflight CSRF.

## 9. Build status of the staged-workflow refactor

```
A0  merge W2 + design P1/P2 to main                      ✅
A1–A3  daemon global inbox + promote + lazy cases        ✅  (#31)
A4  extract global-data hooks (hotspots/feeds/inbox)     ✅  (#32)
A5  lazy/explicit case creation — THE PHANTOM DIES       ✅  (#33, live-verified)
A6  route skeleton (nested routes + CaseProvider+Stepper)  …  next
A7  PlanningDesk (策划台 entry hierarchy)                  …
A8  slice CorpusBoard / ManuscriptDesk (+ remaining hooks) …
A9  delete WriteStudio (old structure removed last)       …
A10 W3/W4 seams (OutlineDesk stub + PATCH /stage)         …  deferred
```
