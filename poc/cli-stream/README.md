# PoC-0 — delegate-CLI stream contract spike

Validates the highest-risk unknown in the plan: the contract for driving the user's installed
Claude Code CLI in headless `stream-json` mode over **piped** stdio. See
[`../../docs/agent-layer.md`](../../docs/agent-layer.md) (PoC-0) and the §3 risk table in
[`../../PLAN.md`](../../PLAN.md).

## Files
- `parser.mjs` — streaming `stream-json` → normalized event parser (seed of `stream/claude-jsonl.ts`).
- `envelope.mjs` — the stdin user-message envelope for `--input-format stream-json`.
- `run.mjs` — harness: spawn CLI, send msg #1, on first `result` inject msg #2 over the still-open
  stdin, capture taxonomy + answers into `findings.<mode>.json` and `raw.<mode>.log`.
- `fake-cli.mjs` — deterministic fixture (no real CLI/auth); also the P1-5/P1-6 test fixture. It
  deliberately splits a JSON object across writes and injects a malformed line.

## Run
```bash
node run.mjs --fake             # deterministic, offline
node run.mjs --real --model haiku
```

## Result: all three questions answered YES

Verified against the **real CLI (claude 2.1.185)** on 2026-06-21.

1. **Stdin envelope (Q1) — CONFIRMED.** The CLI accepts newline-delimited
   `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}`
   on stdin under `--input-format stream-json`. Each message drives one turn.
2. **Mid-session injection (Q2) — CONFIRMED.** Keeping stdin **open** after the first `result`
   and writing a second user message produces a second turn (`PING2`), and the
   `session_id` is **stable across both turns** — this is the mechanism re-edit / comment-to-chat
   relies on.
3. **Taxonomy fully mapped (Q3) — CONFIRMED** after adding `rate_limit_event` (see below). The
   parser produced **0 `unknown`** events, and re-feeding `raw.real.log` in 7-byte chunks reproved
   mid-line reassembly on real data.

Normalized event model emitted by the parser:
`status · text_delta · thinking_delta · tool_use · tool_input_delta · tool_result · usage ·
turn_end{stopReason} · result · error`.

## Findings the real run surfaced (feed into P1-2/P1-5/P1-6)

- **`bypassPermissions` is rejected under root.** It maps to `--dangerously-skip-permissions`,
  which the CLI refuses with root/sudo (`stderr: "…cannot be used with root/sudo privileges…"`).
  The `claude-code` def's default of `bypassPermissions` must therefore be conditional: run the CLI
  as a non-root user, or fall back to `--permission-mode default` + an explicit `--allowedTools`
  allow-list. **Action:** P1-2 should not hardcode `bypassPermissions` unconditionally.
- **`--include-partial-messages` duplicates assistant text.** The model's reply arrives twice — as
  streamed `stream_event/content_block_delta` *and* again in the final `type:"assistant"` block
  (observed as `PING2PING2`). **Action:** P1-6 must pick ONE source of truth — prefer the streamed
  deltas and treat the final `assistant` block as a non-emitting confirmation (or omit
  `--include-partial-messages` and parse only final blocks).
- **Real taxonomy is wider than the docs.** Beyond the documented types, the CLI emits:
  `system` subtypes `post_turn_summary` / `status` / `thinking_tokens`; `stream_event`
  `message_start|message_stop|content_block_start|content_block_stop` and `signature_delta`
  (extended-thinking signatures); and an out-of-band top-level **`rate_limit_event`**
  (`rate_limit_info: { status, resetsAt, rateLimitType:"five_hour", overageStatus, … }`).
  The parser must default-tolerate unknowns (it does) and **surface `rate_limit_event` into the
  BudgetLedger** ([`../../docs/collect-scoring.md`](../../docs/collect-scoring.md#3-budget-caps)).
- **Thinking deltas appear even for trivial prompts** (haiku extended thinking) — `thinking_delta`
  is not optional; handle it.

`findings.fake.json` / `findings.real.json` and `raw.*.log` are gitignored build artifacts of a run.
