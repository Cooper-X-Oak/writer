import { describe, it, expect } from 'vitest';
import { buildWritePrompt } from './prompt.js';

describe('buildWritePrompt', () => {
  it('appends the trimmed topic to the anti-slop brief', () => {
    const p = buildWritePrompt('  AI 写作  ');
    expect(p.endsWith('主题：AI 写作')).toBe(true);
  });

  it('carries the anti-AI-slop guardrails', () => {
    const p = buildWritePrompt('x');
    expect(p).toContain('拒绝 AI 套话');
    expect(p).toContain('只输出文章正文');
  });
});
