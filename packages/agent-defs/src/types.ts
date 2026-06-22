// RuntimeAgentDef — the adapter contract for delegating to a locally installed coding-agent CLI.
// Field set verified against the real open-design runtimes/types.ts; see docs/agent-layer.md.

export interface RuntimeModelOption {
  id: string;
  label: string;
}

export interface RuntimeBuildContext {
  model?: string;
  extraDirs?: string[];
  sessionId?: string;
  resume?: boolean;
  /** Pass --include-partial-messages. NOTE: doing so duplicates assistant text (PoC-0); the
   *  runner must consume one source only. */
  partialMessages?: boolean;
  mcpConfigPath?: string;
  /** Path to a file whose contents are appended to the agent's system prompt. Passed by path (not
   *  inline) so a multi-KB prompt never hits the Windows argv length limit. */
  systemPromptFile?: string;
  /** Override root detection (defaults to process.getuid?.() === 0). Mainly for tests. */
  isRoot?: boolean;
}

export interface RuntimeAgentDef {
  // identity / discovery
  id: string;
  name: string;
  bin: string;
  fallbackBins?: string[];
  versionArgs: string[];
  minVersion?: string;
  installUrl?: string;
  docsUrl?: string;

  // detection
  authProbe?: { args: string[]; timeoutMs?: number };
  versionProbeTimeoutMs?: number;

  // invocation
  buildArgs: (ctx: RuntimeBuildContext) => string[];
  streamFormat: 'claude-stream-json' | 'acp-json-rpc' | 'text-delta';
  promptViaStdin?: boolean;
  promptInputFormat?: 'text' | 'stream-json';
  /** Max bytes the prompt may occupy in argv. 0 ⇒ never via argv (always stdin); guards the
   *  Windows command-line length limit. */
  maxPromptArgBytes?: number;
  supportsImagePaths?: boolean;

  // models
  fallbackModels: RuntimeModelOption[];
  supportsCustomModel?: boolean;
  defaultModelEnvVar?: string;

  // mcp (local-tool exposure)
  externalMcpInjection?: 'claude-mcp-json' | 'acp-merge' | 'opencode-env-content';
  mcpDiscovery?: boolean;

  // misc
  env?: Record<string, string>;
  capabilityFlags?: Record<string, boolean>;
  resumesSessionViaCli?: boolean;
  inactivityTimeoutMs?: number;
}

/** Thrown when an assembled prompt would exceed maxPromptArgBytes (route via stdin/files instead). */
export class RuntimePromptBudgetError extends Error {
  readonly code = 'AGENT_PROMPT_TOO_LARGE' as const;
  constructor(
    readonly limit: number,
    readonly bytes?: number,
    readonly commandLineLength?: number,
  ) {
    super('AGENT_PROMPT_TOO_LARGE');
    this.name = 'RuntimePromptBudgetError';
  }
}
