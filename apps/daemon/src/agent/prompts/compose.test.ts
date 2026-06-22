import { describe, it, expect } from 'vitest';
import { composeSystemPrompt, defaultAxes, type PromptAxes } from './compose.js';

describe('composeSystemPrompt', () => {
  it('includes all three axes in craft-style-template order', () => {
    const axes: PromptAxes = { antiSlop: 'AXIS_CRAFT', style: 'AXIS_STYLE', template: 'AXIS_TEMPLATE' };
    const sp = composeSystemPrompt(axes);
    const iStyle = sp.indexOf('AXIS_STYLE');
    const iCraft = sp.indexOf('AXIS_CRAFT');
    const iTemplate = sp.indexOf('AXIS_TEMPLATE');
    expect(iStyle).toBeGreaterThan(-1);
    expect(iCraft).toBeGreaterThan(iStyle);
    expect(iTemplate).toBeGreaterThan(iCraft);
  });

  it('is topic-agnostic and instructs body-only output', () => {
    const sp = composeSystemPrompt();
    expect(sp).toContain('只输出文章正文');
    expect(sp).not.toContain('主题：');
  });

  it('ships non-empty default axes', () => {
    expect(defaultAxes.antiSlop.length).toBeGreaterThan(0);
    expect(defaultAxes.style.length).toBeGreaterThan(0);
    expect(defaultAxes.template.length).toBeGreaterThan(0);
  });
});
