import { describe, it, expect } from 'vitest';
import { buildWritePrompt, buildSystemPrompt } from './prompt.js';

describe('buildWritePrompt (user message)', () => {
  it('is a lean task framing ending with the trimmed topic', () => {
    const p = buildWritePrompt('  AI 写作  ');
    expect(p.endsWith('主题：AI 写作')).toBe(true);
    expect(p).toContain('直接输出正文');
  });

  it('does not carry the full style brief any more (that moved to the system prompt)', () => {
    const p = buildWritePrompt('x');
    expect(p).not.toContain('写作准则');
    expect(p.length).toBeLessThan(120);
  });
});

describe('buildSystemPrompt (three-axis)', () => {
  it('carries all three axes', () => {
    const sp = buildSystemPrompt();
    expect(sp).toContain('写作风格');
    expect(sp).toContain('写作准则');
    expect(sp).toContain('文章结构');
    expect(sp).toContain('只输出文章正文');
  });
});
