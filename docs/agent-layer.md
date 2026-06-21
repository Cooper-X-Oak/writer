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

## PoC-0 (do this first)

Before building P1-5 (runner) and P1-6 (parser), run a 1–2 day throwaway spike against the
**real** Claude Code CLI:

```bash
claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages
```

Inject an initial prompt **and** a mid-turn follow-up over stdin, logging every output line.

**Success criteria:**
1. Confirm the stdin **user-message envelope** shape (the `--input-format stream-json` envelope
   is under-documented — treat as unverified until this PoC confirms it).
2. Confirm stdin can stay **open across a `tool_use` turn** so a follow-up user message can be
   injected mid-session.
3. The parser handles every output line type actually observed.

This collapses the single highest-risk unknown in the plan (see
[`../PLAN.md`](../PLAN.md) §3 risk table and §5 of the plan) before the real layer is built.

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
