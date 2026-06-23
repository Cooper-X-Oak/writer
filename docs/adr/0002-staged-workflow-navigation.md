# ADR-0002 — Staged writing-workflow navigation

Status: Accepted · 2026-06-23 · Supersedes the single-page studio shell; extends [ADR-0001](0001-evidence-grounded-writing.md).

## Context

After the MVP + W1 资料区 + W2 询证 shipped, the UI was a single route `/` rendering one ~730-line
`'use client'` `write-studio.tsx` that held ~20 `useState` and all flow logic; "stage" was a nested
ternary (`!selected ? landing : stage==='corpus' ? gather : article`). Two structural problems followed:

1. **A phantom "未命名资料区".** Material is per-project (W1), and `ensureCorpus`/`createNewCorpus`
   eagerly created a persisted empty corpus project the moment you clicked ＋新建 or dropped material —
   so there was always an un-deletable empty project, and **no project-independent space** for the
   pre-writing "热点策划 + 资料收集" stage the product is supposed to lead with.
2. **No workflow architecture.** No per-stage pages, no decoupling, no interaction hierarchy — the
   evidence-grounded flow (gather → outline → cited draft) was an `if/else`, not a designed pipeline.

The product thesis (ADR-0001) is materials-first: the 资料区/信息墙 is the heart. The layout buried it
in a 296px rail while the gather-stage center sat near-empty — the inverse of what the workflow needs.

## Decision

Model the app as a **staged writing workflow** built from established paradigms, NOT ad-hoc:

| Layer | Paradigm | Realization in this repo |
|---|---|---|
| Lifecycle | **Hierarchical state machine (Harel statechart)** | Formalize the EXISTING `project.stage` (`corpus\|outline\|draft`, persisted in `manifest.json`). **No XState** — the FSM is already persisted server-side; route + stage field suffice. Guards = tiny pure predicates. |
| Navigation state | **Route-as-state** (Next App Router nested routes + layouts) | URL encodes the state; back/forward = transitions. Every `page.tsx` stays a **server shell** (Next 15.5 RSC-manifest constraint). |
| IA | **Hub-and-spoke + master-detail** | 策划台 = hub; each 案卷 = spoke; the 案卷 list → 案卷 detail = master-detail. |
| Progression | **Stage-gate** | Guarded, non-strictly-linear (`立大纲` disabled until corpus non-empty; always返回 hub). |
| Materials | **Staging-area / inbox → promote (commit)** | A NEW global inbox (project-independent) + the existing per-project corpus, joined by a `promote` action. Extends W1, does not replace it. |
| Decoupling | **Container/presentational + feature-sliced + view-model hooks** | Per-stage containers over shared hooks; presentational components stay pure. |
| Visibility | Make the FSM **visible** | A `Stepper` (策划→攒料→大纲→起草→导出) in the 案卷 layout. |

### State machine

```
planning (no project · route "/")
   │ openProject(title, angle)   ← LAZY/EXPLICIT 立项 (requires a real title → no phantom)
   ▼
PIECE  (route "/p/[id]" · manifest.stage)
   corpus ──立大纲 (guard: cards≥1)──▶ outline ──起草──▶ draft ──export──▶ (exported = derived, NOT a stage)
   案板=CENTER                         大纲=CENTER       手稿=CENTER · corpus DEMOTES to a right 来源栏
   │ backToHub()  (hub-and-spoke return, non-strict)
   ▼ planning
```

`exported` is deliberately NOT added to `ProjectStage`: export is an idempotent action on a `draft`,
re-editing after export must stay legal — avoids a contracts migration and a trap-state guard.

### Routes & layout-per-stage

```
/                      planning · 策划台 (hub): hotspot wall + GLOBAL inbox + 案卷 list   [server shell → PlanningDesk]
/p/[id]                corpus · 案板 (board = CENTER)                                     [server shell → CorpusBoard]
/p/[id]/outline        outline · W3 (seam/stub)                                           [server shell → OutlineDesk]
/p/[id]/write          draft · 手稿 (CENTER); corpus → right 来源栏                        [server shell → ManuscriptDesk]
p/[id]/layout.tsx      shared 案卷 chrome: CaseProvider(id from server params) + Stepper   [server]
```

### Two material levels

- **GLOBAL inbox** — NEW `apps/daemon/src/inbox/inbox-store.ts`, file `dataDir()/inbox.json` (sibling of
  `hotspots.json`/`feeds.json`; no project dir → structurally cannot create a phantom). An inbox item
  **is a `MaterialCard`**; reuse `normalize.ts` builders verbatim. Routes `GET/POST /api/inbox`, image,
  `from-hotspot`, `DELETE`. Hotspots clip INTO the inbox.
- **PER-PROJECT corpus** — unchanged (W1). Joined to the inbox by `POST /api/projects/:id/materials/promote
  { inboxIds[] }` (drain inbox → `materialsStore.addCard`, idempotent via deterministic `hs_<id>`).
- **Lazy cases** — NEW title-guarded `POST /api/cases { title, angle? }` replaces eager `createCorpus`;
  `ensureCorpus` and on-drop auto-create are deleted. Hub drops go to the inbox.

### Component decomposition

`write-studio.tsx` → `PlanningDesk` / `CorpusBoard` / `ManuscriptDesk` containers (feature slices) over
hooks: `useCases · useHotspots · useFeeds · useInbox` (global, server-state) · `useCorpus(id) ·
useArtifact(id)` (per-project, server-state) · `useBlockEditing · useWriteStream` (client-state). The
`Selection/PanelMode` machine and the whole article-edit branch move **verbatim** (lift-and-shift).
W1, W2, P1 tokens, and P2 index card all carry over; `MaterialCardView` is reused by board / inbox / 来源栏.

## Consequences

- The phantom dies at its root: no project dir without an explicit, named 立项.
- The 资料区 becomes the center stage while gathering, and only demotes to a rail when writing — matching
  the materials-first thesis and the per-stage layout the workflow needs.
- Browser/Electron back/forward "just work" (URL = state). Electron still loads one `BrowserWindow` at
  `/`; "独立页面" = distinct routes, not OS windows.
- Migration is strangler-fig (see PLAN §"Phase 3"): daemon inbox first, extract hooks before splitting
  views, lazy-create to kill the phantom, route skeleton, slice containers, delete `write-studio` last.
- W3 大纲, W4/W5 来源栏 citation logic, W6 导出 are DEFERRED — only clean seams are left (`OutlineDesk`
  stub, `PATCH /api/projects/:id/stage`, `SourceRail` reading `useCorpus(id)` read-only).

Trade-off taken: route segments per stage (more files/layouts) over a single `?stage=` query — justified
because each stage needs a different layout, which is exactly what App Router layouts own.
