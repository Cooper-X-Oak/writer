// Writing prompt assembly (P3). The voice/craft/structure now live in the system prompt (three-axis
// injection — see prompts/compose.ts), passed to the CLI via --append-system-prompt-file. The user
// message is lean: just the task and the topic.

import { composeSystemPrompt } from './prompts/compose.js';

/** The three-axis writing system prompt (craft + style + template). Topic-agnostic. */
export function buildSystemPrompt(): string {
  return composeSystemPrompt();
}

/** The per-request user message — minimal framing plus the topic. */
export function buildWritePrompt(topic: string): string {
  return `请就以下主题写一篇文章，直接输出正文。\n\n主题：${topic.trim()}`;
}
