# Implementation Plan — Hotspot Writer (working title)

> Local-first desktop app that reclones the **open-design** (nexu-io/open-design)
> three-layer architecture, repurposed for a hotspot content workflow:
> **collect → AI writing → AI illustration → doc-flow layout → AI re-edit → export**.

Status: planning. Workspace is empty (greenfield). Replace the working title before Phase 0.

---

## 1. Product summary

### Target user
Hotspot content creators (X/Twitter viral-post authors, tech bloggers, trend
watchers, "hot take" KOLs). They need to: spot a hotspot fast → produce an
opinionated, fact-grounded, illustrated draft → distribute.

### Core value
1. **Collection IS sourcing** — not just scraping a hotspot, but capturing
   source URL + quote + screenshot + confidence into **immutable provenance
   nodes**. Content stays traceable and credible.
2. **Delegate, don't rebuild** — no in-house agent loop. Drive the user's own
   installed coding-agent CLI (Claude Code first). Zero model-hosting cost;
   capability tracks the CLI.
3. **Writing + illustration + layout in one artifact** — the doc-flow artifact
   IS HTML; the agent re-edits text / style / layout on the same file.
4. **Local-first** — data, keys, workspace all local. BYOK. No SaaS dependency.

### MVP scope vs later

| Capability | MVP | Later |
|---|---|---|
| Sources | one type (RSS or single X list), manual trigger | source pool, scheduled patrol, HN |
| Hotspot scoring | simple rules + single model pass | engagement-velocity model, trend clustering |
| Provenance | URL + quote + confidence | screenshots, cross-verification, relation graph |
| Writing | delegate Claude Code only, text/JSONL stream | multi-CLI (Codex/Cursor/OpenCode), ACP |
| Illustration | fal.ai single model (Flux), BYOK | multi-model, style presets, inpaint |
| Layout | doc-flow HTML + iframe preview | multi templates, infographics |
| Re-edit | pick element → style; selection → comment-to-chat | edit source, palette, sliders |
| Export | HTML inline + PDF (printToPDF) | PPTX (python-pptx) |
| Platform | Windows 11 (best-effort handling) | macOS / Linux |

**MVP acceptance chain:** collect one hotspot → generate draft → one image →
doc-flow preview → AI rewrites a paragraph → export HTML/PDF.

---

## 2. Architecture

### 2.1 Monorepo layout (pnpm workspace, full ESM, TS strict)

```
hotspot-writer/
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── apps/
│   ├── daemon/                        # privileged local background process
│   │   └── src/
│   │       ├── server.ts              # Express 5 + /api/* mount
│   │       ├── api/                   # HTTP controllers (DTO in/out only)
│   │       │   ├── projects.ts  collect.ts  agent.ts  media.ts  export.ts
│   │       ├── agent/                 # delegate-CLI core (FOUNDATION, borrowed)
│   │       │   ├── registry.ts        # RuntimeAgentDef registry + detect
│   │       │   ├── defs/              # claude-code.ts (+ codex/cursor/opencode stubs)
│   │       │   ├── stream/            # claude-jsonl.ts / acp-jsonrpc.ts / text-delta.ts
│   │       │   ├── runner.ts          # node-pty spawn + stdin inject + stream fwd
│   │       │   └── prompt/            # inject.ts (3-axis assembly) + budget.ts
│   │       ├── collect/               # COLLECTION LAYER (NEW, core differentiator)
│   │       │   ├── orchestrator.ts    # patrol → score → source → write workspace
│   │       │   ├── sources/           # rss.ts / x-list.ts (CDP) / hackernews.ts
│   │       │   ├── cdp/               # browser.ts (persistent ctx + login) / scrape.ts
│   │       │   ├── scoring.ts         # rules prefilter + on-demand model scoring
│   │       │   ├── provenance.ts      # immutable provenance node builder
│   │       │   └── routines.ts        # scheduled-task skeleton (borrowed concept)
│   │       ├── store/                 # better-sqlite3 (Repository pattern) + migrations
│   │       ├── workspace/             # project dir = workspace, file = artifact
│   │       │   ├── manifest.ts  artifacts.ts  watcher.ts (chokidar)
│   │       ├── media/image/fal.ts     # fal.ai wrapper (BYOK)
│   │       ├── export/                # html-inline.ts / pdf.ts (→ Electron IPC)
│   │       └── mcp/server.ts          # MCP SDK: expose local tools to the CLI
│   ├── web/                           # Next.js App Router frontend
│   │   ├── app/                       # collect/ write/ preview/ export/
│   │   ├── components/                # editor(Lexical) / preview-frame / edit-bridge / agent-stream
│   │   └── lib/api/                   # calls daemon /api/* via contracts only
│   └── desktop/                       # Electron shell
│       └── src/                       # main.ts (spawn daemon + load web) / export-pdf.ts
├── packages/
│   ├── contracts/                     # pure DTO (zod). ONLY shared surface web↔daemon
│   ├── agent-defs/                    # RuntimeAgentDef type + shared stream parsers
│   ├── skills/                        # 3-axis semantic assets (verbatim-injected)
│   │   ├── writing/SKILL.md  collect/SKILL.md  illustrate/SKILL.md
│   ├── craft/anti-ai-slop.md          # anti AI-writing-tone rules (replaces anti-design-slop)
│   └── templates/                     # article layouts / mixed text-image / infographics (HTML)
└── resources/STYLE.md.template        # writing style guide template (replaces DESIGN.md)
```

### 2.2 Module responsibilities

| Module | Responsibility | Source |
|---|---|---|
| `agent/` (daemon) | detect CLI → assemble prompt → spawn pty → parse stream → SSE. **Foundation** | borrowed (RuntimeAgentDef) |
| `collect/` (daemon) | patrol sources → score → source/capture → write workspace. **Core differentiator** | NEW |
| `workspace/` | project dir = workspace, file = artifact, sidecar manifest (kind/renderer/exports/entry) | borrowed |
| `store/` | persist project/source/provenance/run metadata | borrowed |
| `contracts` | only shared pure-DTO surface (zod) between web and daemon | borrowed (decoupling) |
| `skills/craft/templates` | 3-axis prompt assets, verbatim-injected into agent system prompt | semantic layer swapped |
| `media/image` | fal.ai Flux/SD, BYOK | image only; video/audio/3D cut |
| `preview-frame` | sandboxed iframe (no allow-same-origin) + srcDoc host bridge + dual-iframe anti-flicker | borrowed |
| `edit-bridge` | data-od-id + postMessage bridge; patch back to HTML file | borrowed |

### 2.3 End-to-end data flow

```
[source pool] --(orchestrator: scheduled/manual)--> [CDP read DOM]
      |                                                    |
      |                                          [scoring: rules prefilter
      |                                           → model scores only survivors]
      |                                                    |
      |                                          [provenance: URL+quote+shot+confidence
      |                                           → immutable node]
      |                                                    |
      └----------------> [write workspace: hotspot.json + provenance/*.json]
                                                           |
                          (user selects hotspot in /collect → create project)
                                                           |
                    [agent runner: inject writing SKILL + STYLE.md + craft,
                     feed provenance nodes as context → delegate Claude Code]
                                                           |
                              [draft → article.html (artifact + manifest)]
                                                           |
                    [media: agent requests image → fal.ai → write assets/]
                                                           |
                    [templates: apply layout → doc-flow HTML]
                                                           |
              [preview iframe renders ← chokidar file-change triggers refresh]
                                                           |
        [edit-bridge: pick element / selection comment → postMessage → chat
         attachment → agent rewrites → patch back to article.html]
                                                           |
                            [export: HTML inline / Electron printToPDF]
```

### 2.4 Key data models (packages/contracts, zod)

- **Source** — `{ id, type: rss|x-list|hackernews, config, enabled, lastVisitedAt, cursor }`
- **Hotspot** — `{ id, sourceId, title, summary, signal:{kind: engagement-spike|new-tech|hot-take|trend, score}, status: candidate|selected|archived, provenanceIds[], capturedAt }`
- **ProvenanceNode** (immutable, append-only) — `{ id, hotspotId, sourceUrl, quote, screenshotPath?, confidence:0..1, crossRefs[], capturedAt }`
- **Project** (= workspace dir) — `{ id, dir, title, hotspotId, artifacts[], createdAt }`
- **Artifact** (= file + sidecar manifest) — `{ id, path, kind: article|image|export, renderer: doc-flow-html|image, entry, exports:{html?,pdf?,pptx?} }`
- **AgentRun** (observability backstop) — `{ id, projectId, cliId, kind: write|edit|collect, promptDigest, stepsUsed, stepBudget, status: running|done|lost|aborted, events[] }`
- **RuntimeAgentDef** (agent-defs) — `{ id, displayName, detect(), buildArgs(ctx), streamFormat: claude-jsonl|acp-jsonrpc|text-delta, promptViaStdin, capabilityFlags }`

---

## 3. Key decisions & risks

| Risk | Level | Decision / mitigation | Phase |
|---|---|---|---|
| User has no Claude Code → core unusable | CRITICAL | First-run `registry.detect()` → guided page with precise diagnosis (not installed / not on PATH / too old / not logged in) + install link + verify button. Any one CLI available unblocks. | 1 |
| X/Twitter ToS / account ban | CRITICAL | RSS + HN (public feeds) as MVP primary, no ToS risk. X list marked "experimental, use at own risk". Playwright persistent user-data-dir, in-app manual login once (no password storage, no fake login). Low-freq patrol (≥15 min) with jitter. | 7 |
| BYOK key leak | CRITICAL | fal.ai key in OS keychain (keytar), never in SQLite plaintext or logs. | 5 |
| Windows pty / path / file-lock | HIGH | Short-hash dir names (avoid ENAMETOOLONG), long-path enable, case-insensitive PATH match via `where`, ConPTY backend verify, chokidar `awaitWriteFinish` + atomic write-then-rename. | 1, 2 |
| Agent gets lost / cost blowup | HIGH | `prompt/budget.ts` step/token hard caps; CDP DOM read is primary (model only at scoring + cross-verify); lost-detection (over budget / N steps no file write / repeated tool call) → UI abort/restart; AgentRun.events append-only timeline. | 3 |
| Stream-parser edge bugs | HIGH | JSONL chunk/half-line/malformed handling; unit coverage ≥90%. | 1 |
| MCP local-tool exposure | MEDIUM | Expose read-provenance/write-artifact/list-templates via MCP SDK instead of raw shell. | 3 |
| iframe escape | MEDIUM | Preview iframe deliberately no allow-same-origin; host bridge via srcDoc injection. | 4 |

---

## 4. Phases

- **Phase 0 — Scaffold.** pnpm workspace + tsconfig + ESM; `contracts` initial DTO; daemon `/api/health`; web calls health; Electron spawns daemon + loads web. *Verify:* `pnpm dev` → Electron window shows web showing daemon health ok.
- **Phase 1 — Agent layer (top-priority foundation).** RuntimeAgentDef type; `defs/claude-code.ts`; `registry.ts` detect + first-run guide; `runner.ts` pty + stdin; `stream/claude-jsonl.ts`; `/api/agent` SSE; `agent-stream` UI. *Verify:* web prompt → delegate local Claude Code → live stream. Windows pty verified.
- **Phase 2 — Artifact model + workspace (foundation).** `store/` sqlite + migrations + repos; `manifest.ts` + `artifacts.ts`; `watcher.ts` (awaitWriteFinish + atomic write); `/api/projects` CRUD. *Verify:* create project → workspace dir + manifest; file change observed by web.
- **Phase 3 — Writing chain (3-axis prompt).** `skills/writing/SKILL.md` + `craft/anti-ai-slop.md` + `STYLE.md.template`; `prompt/inject.ts` + `budget.ts`; `mcp/server.ts` exposes write-artifact; agent writes `article.html`. *Verify:* topic → inject writing skill → article.html draft, anti-AI-tone rules in effect.
- **Phase 4 — Preview + re-edit bridge.** `preview-frame` sandboxed dual-iframe + srcDoc host bridge + CSS swap; `edit-bridge` data-od-id + postMessage (MVP: pick-element style + selection comment-to-chat); patch back to article.html. *Verify:* preview renders; element style edit persists; selection comment becomes chat attachment triggering rewrite.
- **Phase 5 — Illustration.** `media/image/fal.ts` Flux + keytar; agent requests image → generate → write `assets/` → reference in HTML; `/api/media`. *Verify:* agent triggers image → fal.ai → image into doc-flow preview.
- **Phase 6 — Export.** `export/html-inline.ts`; `export/pdf.ts` via Electron printToPDF IPC. *Verify:* one-click export self-contained HTML + PDF.
- **Phase 7 — Collection layer (core differentiator, partly parallel with 3–6).** `cdp/browser.ts` persistent ctx + login guide; `scrape.ts`; `sources/rss.ts` (MVP primary) + `x-list.ts` (experimental); `scoring.ts` prefilter + on-demand model + budget cap; `provenance.ts` immutable nodes; `orchestrator.ts`; `routines.ts` (MVP manual trigger); `/api/collect` + web `/collect` UI. *Verify:* config RSS → collect → score → hotspot.json with provenance → UI lists hotspots → select creates project (feeds Phase 3).
- **Phase 8 — Full chain + MVP acceptance.** Wire Phases 1–7; multi-CLI def stubs (detect + placeholder); Windows compat regression. *Verify:* end-to-end minimum value chain.

---

## 5. Dependencies & ordering

```
Phase 0 (scaffold)
  ├─> Phase 1 (agent layer)        ── most critical foundation (delegate model core)
  └─> Phase 2 (artifact/workspace) ── carrier for all artifacts
        (Phase 1 ∥ Phase 2; both only need Phase 0)

Phase 3 (writing) needs 1 + 2.
Phase 3 (writing) ∥ Phase 7 (collection)  — both need 1+2, mutually independent
   (collection output hotspot.json/provenance is writing's input; contract via DTO,
    can mock and develop in parallel).
Phase 4 (preview/edit) ∥ Phase 5 (illustration) — both need Phase 3 artifact.
skills/craft/templates authoring — parallel throughout (pure content).
```

Critical path: `0 → 1 → 3 → 4 → 8` (with `2` feeding `3`, `6` feeding `8`,
`7` merging at `8`).

---

## 6. Test strategy (target 80% coverage; high-risk modules ≥90%)

**Unit (Vitest):** `agent-defs` buildArgs/detect parsing · `stream/claude-jsonl`
chunk/half-line/malformed (≥90%) · `prompt/inject`+`budget` order/prune/cap ·
`collect/scoring` thresholds/signal/cap · `collect/provenance` immutability/
confidence/crossRef depth (≥90%) · `workspace/manifest` (de)serialize ·
`contracts` zod boundaries · Windows path utils (ENAMETOOLONG/separator/case) (≥90%).

**Integration:** daemon `/api/*` via supertest · agent runner via **fake CLI**
(script emitting fixed JSONL) → spawn→parse→SSE · store repos + migrations +
tx · collect orchestrator (RSS fixture + recorded-DOM CDP mock) · media via
mock server (BYOK inject + artifact landing) · edit-bridge patch correctness.

**E2E (Playwright on Electron):** first-run guide (no CLI → guide page; mock
detect → main) · collect→draft · preview edit · export non-empty files ·
visual regression at 768/1024/1440.

**Constraints:** real Claude Code CLI **not in CI** (use fake CLI; real-CLI via
local smoke script) · CDP/Playwright via recorded DOM fixtures (avoids ToS &
flakiness) · fal.ai/keychain fully mocked, keys never in test code.

---

## Differentiator vs open-design

NEW `collect/` (collection + provenance, the core value). Semantic layer swapped:
DESIGN.md → STYLE.md, anti-design-slop → anti-AI-writing-tone, design-templates →
article layouts. Media: image only. Everything else (agent layer / artifact model /
3-layer decoupling / preview / edit bridge / export) borrowed from the verified
open-design architecture.
