import { describe, it, expect } from 'vitest';
import { claudeCode, isRootProcess } from './claude-code.js';

describe('claude-code def', () => {
  it('has the expected static fields', () => {
    expect(claudeCode.id).toBe('claude');
    expect(claudeCode.streamFormat).toBe('claude-stream-json');
    expect(claudeCode.promptViaStdin).toBe(true);
    expect(claudeCode.promptInputFormat).toBe('stream-json');
    expect(claudeCode.maxPromptArgBytes).toBe(0);
    expect(claudeCode.capabilityFlags?.duplicatesTextWithPartialMessages).toBe(true);
    expect(claudeCode.fallbackModels.map((m) => m.id)).toEqual(['opus', 'sonnet', 'haiku']);
  });

  it('builds base args (non-root → bypassPermissions)', () => {
    expect(claudeCode.buildArgs({ isRoot: false })).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'bypassPermissions',
    ]);
  });

  it('degrades to acceptEdits under root (PoC-0 finding)', () => {
    const args = claudeCode.buildArgs({ isRoot: true });
    expect(args).toContain('acceptEdits');
    expect(args).not.toContain('bypassPermissions');
  });

  it('includes optional flags: model, dirs, new session, mcp, partial messages', () => {
    const args = claudeCode.buildArgs({
      isRoot: false,
      model: 'haiku',
      extraDirs: ['/a', '/b'],
      sessionId: 'sess',
      partialMessages: true,
      mcpConfigPath: '/mcp.json',
    });
    const joined = args.join(' ');
    expect(args).toContain('--include-partial-messages');
    expect(joined).toContain('--model haiku');
    expect(joined).toContain('--add-dir /a');
    expect(joined).toContain('--add-dir /b');
    expect(joined).toContain('--session-id sess');
    expect(joined).toContain('--mcp-config /mcp.json --strict-mcp-config');
  });

  it('uses --resume instead of --session-id when resuming', () => {
    const args = claudeCode.buildArgs({ isRoot: false, sessionId: 'sess', resume: true });
    expect(args.join(' ')).toContain('--resume sess');
    expect(args).not.toContain('--session-id');
  });

  it('defaults the root decision to the live process when isRoot omitted', () => {
    const args = claudeCode.buildArgs({});
    expect(args).toContain(isRootProcess() ? 'acceptEdits' : 'bypassPermissions');
    expect(typeof isRootProcess()).toBe('boolean');
  });
});
