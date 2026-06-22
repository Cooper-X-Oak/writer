// User message for a single-block rewrite. The voice/craft/structure come from the same three-axis
// system prompt as a fresh draft (buildSystemPrompt), so a rewrite stays in the article's register.

export function buildRewritePrompt(blockText: string, instruction: string): string {
  const ask = instruction.trim() || '在不改变原意的前提下，让这段更利落、更有力。';
  return [
    '请改写下面这一段文字。',
    `要求：${ask}`,
    '只输出改写后的这一段正文，不要加引号、不要解释、不要输出多段。',
    '',
    '原文：',
    blockText.trim(),
  ].join('\n');
}
