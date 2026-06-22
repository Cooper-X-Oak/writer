import type { RuntimeAgentDef, RuntimeBuildContext } from '../types.js';

/** True when the current process runs as root. Windows has no getuid → optional chaining yields
 *  undefined → false. */
export function isRootProcess(): boolean {
  return process.getuid?.() === 0;
}

export const claudeCode: RuntimeAgentDef = {
  id: 'claude',
  name: 'Claude Code',
  bin: 'claude',
  fallbackBins: ['openclaude'],
  versionArgs: ['--version'],
  minVersion: '2.0.0',
  installUrl: 'https://docs.claude.com/en/docs/claude-code/overview',
  authProbe: { args: ['auth', 'status'], timeoutMs: 5000 },
  streamFormat: 'claude-stream-json',
  promptViaStdin: true,
  promptInputFormat: 'stream-json',
  maxPromptArgBytes: 0, // prompt always via stdin, never argv (Windows cmdline limit — docs/windows-compat.md)
  supportsImagePaths: true,
  fallbackModels: [
    { id: 'opus', label: 'Opus' },
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'haiku', label: 'Haiku' },
  ],
  defaultModelEnvVar: 'ANTHROPIC_MODEL',
  externalMcpInjection: 'claude-mcp-json',
  // PoC-0 finding: --include-partial-messages duplicates assistant text (streamed deltas AND the
  // final `assistant` block). The runner (P1-3) consumes one source only — this flag advertises it.
  capabilityFlags: { sessions: true, images: true, mcp: true, duplicatesTextWithPartialMessages: true },

  buildArgs(ctx: RuntimeBuildContext): string[] {
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
    if (ctx.partialMessages) args.push('--include-partial-messages');
    if (ctx.model) args.push('--model', ctx.model);
    // Three-axis writing prompt (P3) — appended to the default system prompt, read from a file so a
    // multi-KB prompt never hits the Windows command-line limit.
    if (ctx.systemPromptFile) args.push('--append-system-prompt-file', ctx.systemPromptFile);
    for (const dir of ctx.extraDirs ?? []) args.push('--add-dir', dir);
    if (ctx.sessionId) args.push(ctx.resume ? '--resume' : '--session-id', ctx.sessionId);
    if (ctx.mcpConfigPath) args.push('--mcp-config', ctx.mcpConfigPath, '--strict-mcp-config');
    // PoC-0 finding: bypassPermissions (= --dangerously-skip-permissions) is rejected under root.
    // Degrade to acceptEdits there (auto-accepts edits, not root-blocked). Non-root — including
    // Windows, where getuid is undefined — keeps bypassPermissions.
    const root = ctx.isRoot ?? isRootProcess();
    args.push('--permission-mode', root ? 'acceptEdits' : 'bypassPermissions');
    return args;
  },
};
