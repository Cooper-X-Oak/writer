# Issues — Phase 0 & Phase 1 (issue-ready tasks)

Each task below is sized for a single GitHub issue. Fields:
**Goal · Deliverable · Acceptance · Depends-on**. Phase/scope is defined in
[`../PLAN.md`](../PLAN.md) §4. Design detail for the agent layer lives in
[`agent-layer.md`](./agent-layer.md).

---

## Phase 0 — Scaffold

Goal of the phase: `pnpm dev` opens an Electron window whose web UI shows the local
daemon's health. Greenfield monorepo, full ESM, TS strict.

### P0-1 — Monorepo bootstrap
- **Goal:** pnpm workspace skeleton everything else builds on.
- **Deliverable:** `pnpm-workspace.yaml`, `tsconfig.base.json` (ESM, `module: NodeNext`,
  `moduleResolution: NodeNext`, `strict: true`), `apps/*` + `packages/*` dirs, a dev
  orchestrator (`turbo` or `concurrently`) wired to a root `pnpm dev`.
- **Acceptance:** `pnpm install` completes clean; `pnpm -r typecheck` passes on empty
  packages; the `pnpm dev` task graph is defined (even if components are stubs).
- **Depends-on:** —

### P0-2 — `contracts` package skeleton
- **Goal:** the only shared surface between web and daemon.
- **Deliverable:** `@app/contracts` exporting a `Health` DTO and a stub `Project` DTO.
  Policy: **plain TS interfaces for internal API DTOs; zod schemas only for untrusted
  external input** (mirrors open-design, where zod is concentrated on parsed external data
  such as scraped content and plugin manifests).
- **Acceptance:** types import cleanly from both `apps/web` and `apps/daemon`;
  `pnpm --filter @app/contracts build` succeeds.
- **Depends-on:** P0-1

### P0-3 — daemon `/api/health`
- **Goal:** privileged local background process answers health.
- **Deliverable:** Express 5 server, `/api/*` mount, `GET /api/health → { status, version }`,
  configurable port (env), structured logging.
- **Acceptance:** `curl /api/health` returns 200 with typed JSON; port overridable via env.
- **Depends-on:** P0-1, P0-2

### P0-4 — web → health
- **Goal:** Next.js App Router frontend talks to the daemon through contracts only.
- **Deliverable:** a page that calls daemon health via `apps/web/lib/api`, typed with
  `@app/contracts`.
- **Acceptance:** page renders "daemon ok" + version; no `any` in the call path.
- **Depends-on:** P0-3

### P0-5 — Electron shell
- **Goal:** desktop wrapper spawns the daemon and loads the web app.
- **Deliverable:** `apps/desktop/src/main.ts` spawns the daemon as a child process, waits
  for health, loads the web URL; tears the daemon down on quit.
- **Acceptance:** `pnpm dev` opens an Electron window showing health ok; no orphan daemon
  after the window closes.
- **Depends-on:** P0-3, P0-4

### P0-6 — CI gate
- **Goal:** keep the scaffold green.
- **Deliverable:** CI running Vitest + typecheck + lint on PRs.
- **Acceptance:** CI is green on the scaffold; a deliberately introduced type error fails CI.
- **Depends-on:** P0-1

---

## Phase 1 — Agent layer (top-priority foundation)

Goal of the phase: a web prompt delegates to the user's locally installed Claude Code CLI
and renders the live stream. **Do [PoC-0](./agent-layer.md#poc-0-do-this-first) before
P1-5/P1-6.**

### P1-1 — `RuntimeAgentDef` type
- **Goal:** the adapter contract for any coding-agent CLI.
- **Deliverable:** `packages/agent-defs` exporting `RuntimeAgentDef`, `RuntimeModelOption`,
  `RuntimeBuildContext`, and `RuntimePromptBudgetError { code:'AGENT_PROMPT_TOO_LARGE',
  bytes?, commandLineLength?, limit }` (full shape in [`agent-layer.md`](./agent-layer.md)).
- **Acceptance:** compiles; a unit test instantiates a fake def and calls `buildArgs`.
- **Depends-on:** P0-2

### P1-2 — `claude-code` def
- **Goal:** the first concrete CLI adapter.
- **Deliverable:** `defs/claude-code.ts` with fields + `buildArgs` per the pseudocode in
  [`agent-layer.md`](./agent-layer.md#claude-code-def-pseudocode).
- **Acceptance:** unit test asserts the **exact argv** for each ctx variant
  (model set/unset · extra dirs · session resume vs new · partial-messages on/off).
- **Depends-on:** P1-1

### P1-3 — Launch resolution
- **Goal:** turn a def's `bin` into a real executable, cross-platform.
- **Deliverable:** `launch.ts` `resolveAgentLaunch(def, env)` resolving `bin`/`fallbackBins`
  to an absolute path (`where` on Windows, PATH walk on POSIX) and prepending the bin dir to
  the child PATH.
- **Acceptance:** fixture-PATH unit test resolves the bin; a missing bin yields a diagnostic
  object, not a throw.
- **Depends-on:** P1-1

### P1-4 — Registry + detect + first-run diagnosis
- **Goal:** know precisely why a CLI is (un)usable on first run.
- **Deliverable:** `registry.ts` (static `BASE_AGENT_DEFS` + local-profile overrides; duplicate
  `id` throws) and `detection.ts` mapping to states
  `NOT_INSTALLED / NOT_ON_PATH / TOO_OLD / NOT_LOGGED_IN / READY` via version probe + `authProbe`.
- **Acceptance:** each state reproduced via mocked launch/probe; any single READY CLI unblocks
  the app.
- **Depends-on:** P1-3

### P1-5 — Pipe runner
- **Goal:** drive the CLI over plain pipes (no PTY — matches open-design).
- **Deliverable:** `runner.ts` spawning `child_process` with piped stdio; prompt written to
  stdin as a `stream-json` user envelope; **stdin held open while the last
  `turn_end.stopReason === 'tool_use'`**, closed otherwise; lost-detection wired.
- **Acceptance:** integration test against a **fake CLI** (script emitting fixed JSONL) →
  spawn → parse → ordered events; stdin lifecycle verified by injecting a mid-turn follow-up.
- **Depends-on:** P1-3, P1-6

### P1-6 — Claude stream-json parser
- **Goal:** robustly parse the CLI's `stream-json` output.
- **Deliverable:** `stream/claude-jsonl.ts` `createClaudeStreamHandler(onEvent) → { feed, flush }`;
  newline-split buffering; emits `status / text_delta / thinking_delta / tool_use /
  tool_input_delta / tool_result / usage / turn_end{stopReason} / error`.
- **Acceptance:** unit coverage **≥90%** including: chunk split mid-line, malformed line
  skipped (not fatal), multiple events in one chunk, `--include-partial-messages` deltas vs
  final-wrapper-only builds.
- **Depends-on:** P1-1

### P1-7 — `/api/agent` SSE
- **Goal:** expose a run to the web as a live event stream.
- **Deliverable:** `api/agent.ts` — POST starts a run; SSE streams parsed events; an `AgentRun`
  record (in-memory acceptable for Phase 1) with append-only `events[]`; an abort endpoint.
- **Acceptance:** supertest receives ordered SSE events from the fake CLI; abort stops the child.
- **Depends-on:** P1-5

### P1-8 — Prompt-size budget
- **Goal:** never blow the Windows command-line limit.
- **Deliverable:** `prompt/budget.ts` + `maxPromptArgBytes` enforcement → throw
  `RuntimePromptBudgetError`; large context routed via **stdin/files, never argv**
  (see [`windows-compat.md`](./windows-compat.md#42-spawn-enametoolong--command-line-length-not-path)).
- **Acceptance:** an oversize prompt throws with `bytes`/`limit` populated; the Windows
  command-line guard is unit-tested.
- **Depends-on:** P1-1

### P1-9 — `agent-stream` UI
- **Goal:** see the delegated run live.
- **Deliverable:** a web prompt box rendering SSE text/thinking deltas, tool calls, and status;
  surfacing lost/abort.
- **Acceptance:** a web prompt produces a live stream from the fake CLI (and the real CLI in a
  local smoke run).
- **Depends-on:** P1-7

### P1-10 — Windows agent-run smoke
- **Goal:** prove piped headless delegation works on Windows with no TTY.
- **Deliverable:** a documented smoke script invoking the real `claude` headless over pipes on
  Win11.
- **Acceptance:** smoke script passes on Windows; a captured event log is attached to the issue.
- **Depends-on:** P1-5
