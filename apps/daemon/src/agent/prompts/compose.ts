// Compose the three writing axes into one system prompt. Fixed order: craft (how to write) →
// style (voice) → template (structure). Pure + axes injectable so the composition is unit-testable
// and the axes can later be swapped (the style marketplace).

import { ANTI_SLOP } from './anti-slop.js';
import { STYLE } from './style.js';
import { ARTICLE_TEMPLATE } from './templates.js';

export interface PromptAxes {
  /** craft — anti-AI-slop rules. */
  antiSlop: string;
  /** voice. */
  style: string;
  /** structural skeleton. */
  template: string;
}

export const defaultAxes: PromptAxes = {
  antiSlop: ANTI_SLOP,
  style: STYLE,
  template: ARTICLE_TEMPLATE,
};

function section(heading: string, body: string): string {
  return `## ${heading}\n\n${body.trim()}`;
}

/** The full three-axis system prompt. Topic-agnostic — the topic goes in the user message. */
export function composeSystemPrompt(axes: PromptAxes = defaultAxes): string {
  return [
    '你是一名为中文读者写作的热点内容创作者。以下是你必须遵循的写作准则、风格与结构。',
    section('写作风格', axes.style),
    section('写作准则', axes.antiSlop),
    section('文章结构', axes.template),
    '只输出文章正文。不要解释你在做什么，不要使用任何工具，不要向用户反问。',
  ].join('\n\n');
}
