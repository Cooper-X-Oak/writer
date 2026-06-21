# Agent layer — `RuntimeAgentDef` adapter + `claude-code` def

The agent layer detects the user's installed coding-agent CLI, assembles a prompt, spawns the
CLI, parses its output stream, and relays events to the web UI over SSE. It is **borrowed from
the verified open-design architecture** (`apps/daemon/src/runtimes/*`), with one correction
baked in here: **agent runs are spawned as plain piped child processes, not PTYs.** node-pty /
ConPTY is reserved for an optional interactive terminal only (see
[`windows-compat.md`](./windows-compat.md#43-conpty--optional--deferred-agent-runner-uses-pipes)).

Related: [`../PLAN.md`](../PLAN.md) §2.2 / §3 · issues in
[`issues-phase-0-1.md`](./issues-phase-0-1.md).

---

## PoC-0 (done ✅ — see [`poc/cli-stream/`](../poc/cli-stream/README.md))

A throwaway spike drove the **real** Claude Code CLI (2.1.185) over piped stdio:

```bash
claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages
```

**Success criteria — all confirmed:**
1. ✅ Stdin **user-message envelope** is newline-delimited
   `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}` — accepted; one turn per message.
2. ✅ Stdin can stay **open across turns**; a second user message produces a second turn with a
   **stable `session_id`** (the basis for re-edit / comment-to-chat).
3. ✅ The parser maps the full observed taxonomy with **0 `unknown`** events (after adding
   `rate_limit_event`); it tolerates mid-line chunk splits and malformed lines.

**Findings to fold into P1-2/P1-5/P1-6** (detail in the PoC README):
- `bypassPermissions` is **rejected under root** (maps to `--dangerously-skip-permissions`); the
  `claude-code` def must not hardcode it — run non-root or use `--permission-mode default` + an
  explicit `--allowedTools` allow-list.
- `--include-partial-messages` **duplicates** assistant text (streamed deltas **and** the final
  `assistant` block); P1-6 must pick one source of truth.
- Real taxonomy is wider than the docs (`system` subtypes `post_turn_summary|status|thinking_tokens`,
  `stream_event` `message_start|stop` / `content_block_start|stop` / `signature_delta`, and an
  out-of-band top-level **`rate_limit_event`** → surface into the BudgetLedger). Default-tolerate unknowns.

---

## `RuntimeAgentDef` interface

Concrete fields, adapted from the verified open-design `runtimes/types.ts`:

```ts
export interface RuntimeAgentDef {
  // identity / discovery
  id: string;                       // 'claude'
  name: string;                     // 'Claude Code'
  bin: string;                      // 'claude'
  fallbackBins?: string[];          // ['openclaude']
  versionArgs: string[];            // ['--version']
  installUrl?: string;
  docsUrl?: string;

  // detection
  authProbe?: { args: string[]; timeoutMs?: number };  // reveals login state non-interactively
  versionProbeTimeoutMs?: number;
  minVersion?: string;              // drives the TOO_OLD diagnosis

  // invocation
  buildArgs: (ctx: RuntimeBuildContext) => string[];
  streamFormat: 'claude-stream-json' | 'acp-json-rpc' | 'text-delta';
  promptViaStdin?: boolean;
  promptInputFormat?: 'text' | 'stream-json';
  maxPromptArgBytes?: number;       // guards the Windows cmdline limit (0 ⇒ never via argv)
  supportsImagePaths?: boolean;

  // models
  fallbackModels: RuntimeModelOption[];   // [{ id:'opus', label:'Opus' }, ...]
  supportsCustomModel?: boolean;
  defaultModelEnvVar?: string;            // 'ANTHROPIC_MODEL'

  // mcp (local-tool exposure)
  externalMcpInjection?: 'claude-mcp-json' | 'acp-merge' | 'opencode-env-content';
  mcpDiscovery?: boolean;

  // misc
  env?: Record<string, string>;
  capabilityFlags?: Record<string, boolean>;
  resumesSessionViaCli?: boolean;
  inactivityTimeoutMs?: number;
}

export interface RuntimeModelOption { id: string; label: string }

export interface RuntimeBuildContext {
  model?: string;
  extraDirs: string[];
  sessionId?: string;
  resume?: boolean;
  partialMessages?: boolean;
  mcpConfigPath?: string;
}

export class RuntimePromptBudgetError extends Error {
  readonly code = 'AGENT_PROMPT_TOO_LARGE' as const;
  constructor(
    public readonly limit: number,
    public readonly bytes?: number,
    public readonly commandLineLength?: number,
  ) {
    super('AGENT_PROMPT_TOO_LARGE');
  }
}
```

---

## `claude-code` def (pseudocode)

Flags verified against the current Claude Code headless interface.

```ts
export const claudeCode: RuntimeAgentDef = {
  id: 'claude',
  name: 'Claude Code',
  bin: 'claude',
  fallbackBins: ['openclaude'],
  versionArgs: ['--version'],
  authProbe: { args: ['auth', 'status'], timeoutMs: 5000 },  // PoC-0: confirm exact subcommand
  minVersion: '2.0.0',
  streamFormat: 'claude-stream-json',
  promptViaStdin: true,
  promptInputFormat: 'stream-json',
  supportsImagePaths: true,
  fallbackModels: [
    { id: 'opus', label: 'Opus' },
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'haiku', label: 'Haiku' },
  ],
  defaultModelEnvVar: 'ANTHROPIC_MODEL',
  externalMcpInjection: 'claude-mcp-json',
  maxPromptArgBytes: 0,            // 0 ⇒ never pass the prompt via argv; always via stdin
  buildArgs(ctx) {
    const a = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
    if (ctx.partialMessages) a.push('--include-partial-messages');
    if (ctx.model)           a.push('--model', ctx.model);
    for (const d of ctx.extraDirs) a.push('--add-dir', d);
    if (ctx.sessionId)       a.push(ctx.resume ? '--resume' : '--session-id', ctx.sessionId);
    if (ctx.mcpConfigPath)   a.push('--mcp-config', ctx.mcpConfigPath, '--strict-mcp-config');
    a.push('--permission-mode', 'bypassPermissions');   // headless; tools constrained via MCP allow-list
    return a;
  },
  capabilityFlags: { sessions: true, images: true, mcp: true },
};
```

---

## Pipe runner (replaces "node-pty spawn")

```ts
const child = spawn(launch.launchPath, def.buildArgs(ctx), {
  stdio: ['pipe', 'pipe', 'pipe'],
  env,
  cwd: workspaceDir,
});
```

- Write the prompt to stdin as a `stream-json` **user envelope** (shape confirmed by PoC-0;
  expected newline-delimited
  `{ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }`).
- Feed stdout into `createClaudeStreamHandler` → emit SSE events.
- **Keep stdin open while the last `turn_end.stopReason === 'tool_use'`** (enables mid-turn
  streaming / follow-ups); otherwise close stdin to end the turn.
- **Lost-detection:** over `stepBudget`, N steps with no artifact write, or a repeated identical
  tool call → set `AgentRun.status = 'lost'` and expose abort/restart in the UI.

The `stream-json` parser (`stream/claude-jsonl.ts`) emits:
`status`, `text_delta`, `thinking_delta`, `tool_use {id,name,input}`, `tool_input_delta`,
`tool_result`, `usage`, `turn_end {stopReason}`, `error`. It must tolerate chunk splits
mid-line, malformed lines (skip, don't crash), multiple events per chunk, and both
partial-message and final-wrapper-only builds.

---

## Detection state machine (first-run guide)

```
resolveAgentLaunch(def, env)
  ├─ no path resolved ───────────────► NOT_INSTALLED | NOT_ON_PATH
  └─ path resolved
       run versionArgs → parse "x.y.z"
         ├─ < minVersion ─────────────► TOO_OLD
         └─ ok → run authProbe
              ├─ non-zero / "not logged in" ► NOT_LOGGED_IN
              └─ ok ──────────────────────► READY
```

The first-run UI shows the precise diagnosis plus an install/login link and a **Verify** button.
**Any single READY CLI unblocks the app.**

---

## MCP (local-tool exposure)

Expose `read-provenance`, `write-artifact`, and `list-templates` to the CLI via the MCP SDK,
wired with `--mcp-config <path>` + `--strict-mcp-config`. Constrain capability through the def's
MCP allow-list rather than raw shell access.
