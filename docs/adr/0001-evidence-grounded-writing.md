# ADR-0001 — Evidence-grounded writing (信息墙 / 资料区) as the product core

- **Status:** Accepted — 2026-06-22
- **Supersedes:** the linear "collect → generate → tweak" framing of Core Value #1/#3 in [`PLAN.md`](../../PLAN.md) §1 (v1)
- **Stands:** the §2 architecture (monorepo, agent layer, artifact model, windows-compat) is reused unchanged

## Context

- **MVP (P0–P9) shipped** and merged to `main` (repo public, CI green): hotspot collect (HN/RSS) → delegate the local Claude Code CLI → streamed draft → per-paragraph AI/manual edit → illustration (Electron) → export HTML/PDF, plus P9 (manual editing, RSS mgmt, project mgmt, provenance display).
- A **product/UX audit (2026-06-22, 45 findings)** found the app is happy-path-only and **interaction-thin**: the user is a spectator — pick a hotspot, a black box writes the whole draft, then minor tweaks. The richest decisions (angle / structure / stance / length) are baked into an invisible three-axis prompt. Root cause: the product is modeled as a **linear pipeline**, so there is nothing to steer.
- **Owner's reframing:** hotspot writing (锐评 / 洗稿 / 观点拓展) is *not* "the author invents from a blank page." It is **synthesis grounded in discovered materials.** Even an author's own idea must land back on reference materials.
- **Continuity, not a rewrite:** PLAN.md v1 already listed "provenance: screenshots, cross-verification, relation graph" as a *Later* item. This decision **promotes that provenance seed to the product core.**

## Decision

Reframe the product as **evidence-grounded, steerable writing.** Writing = synthesis over a curated, cited material corpus ("信息墙 / 资料区"), traceable end to end.

1. **资料区 (Material corpus) is the heart** — a pool of heterogeneous **material cards** (`link | image | md | text | code`), each carrying: `origin` (auto-询证 | manual-drop), `class` (原始 | 补充 | 对比), optional `source` (url/title/author/date), `content` (quote/body/image/snippet), `confidence`, `tags`, `note`.
2. **Two ingest paths, one corpus.** (A) agent auto-discovers hotspots + **询证** (fan-out gather → classify 原/补/对 → cross-verify); (B) the human drops arbitrary material. Both normalize into cards in the same 资料区. **Ingest and outline-generation are separated concerns** — "how the corpus is filled" is independent of "how the outline is produced."
3. **初始化大纲 (Grounded outline)** = `{ 主旨 thesis, 叙事 narrative, node ↔ material mapping }`. The outline grows *from* the corpus; every node is anchored to specific cards. It is a mapped skeleton, not a list of headings.
4. **Cited draft + bidirectional citation tracing.** Every claim links to its card(s); a citation sidebar shows cited / unused / coverage; click-card ↔ click-citation navigation.
5. **Two-layer architecture.**
   - **Layer 1 — per-article tool:** 资料区 → 初始化大纲 → 起草 → 精修 → 导出.
   - **Layer 2 — 叙事大纲市场 + 写作规范 (accumulating asset, deferred):** a scenario-tagged library of narrative templates + writing norms (STYLE.md) + expert prompts, pickable by human or agent; good articles' narrative skeletons abstract back into new templates (flywheel). This is the **writing analog of open-design's design-spec library** — it raises standardized *writing* capability the way open-design raises standardized *design* capability.
6. **Day-1 commitment:** model 叙事 as a first-class, named, reusable `NarrativeTemplate { scenario, shape, slots (section roles), norms }` from the start — even though the marketplace UI/sharing is deferred — so the library can grow from 1–2 built-ins into a market **without a schema change.**

## Consequences

**Positive**
- The interaction surface multiplies: curating the corpus, steering the brief/angle, editing the *grounded* outline, and the cited refine loop are all genuine user-participation points — directly answering the audit's "interaction-thin" root cause.
- Differentiation + moat: traceable, multi-source grounded writing; the narrative market is the accumulating asset that compounds over time.
- High reuse, low waste: the collection layer, provenance, write engine, edit bridge, and export are all reused. Much of the new value is **wiring already-built-but-dark capabilities** (excerpt, restore endpoint, costUsd, provenance) plus the corpus / outline / citation layer.

**Costs / risks**
- Larger build than the MVP. The write engine changes from "draft the whole topic" to **"expand node N from these cards."**
- **询证 fan-out** (gathering supplementary/contrasting material + cross-verification) is the hardest new subsystem (search/fetch breadth and quality; SSRF is already guarded in `collect/fetch-util.ts`).
- Heterogeneous ingestion (image/code/md) needs a normalization layer.
- Citation ↔ block mapping must survive structural edits; extend the existing positional-block-id discipline to citations.

**Deferred (Later):** the marketplace UI + sharing + agent auto-selection + flywheel abstraction; the richer STYLE.md / craft norm library.

See [`PLAN.md`](../../PLAN.md) §"Phase 2 — Evidence-grounded writing" for the phased plan (W1–W7) and the reuse-vs-new map.
