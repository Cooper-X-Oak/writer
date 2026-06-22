// Minimal article-HTML rendering. The agent emits plain text; we wrap it as a standalone HTML
// document. Model output is UNTRUSTED for rendering purposes (it will later be shown in an iframe),
// so every dynamic value is HTML-escaped here — never inject raw model text into markup.

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Wrap a plain-text body into a standalone article document. Blank-line-separated blocks become
 *  paragraphs; single newlines become <br/>. All text is escaped. */
export function buildArticleHtml(title: string, body: string): string {
  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block.trim()).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
  return [
    '<!doctype html>',
    '<html lang="zh">',
    '<head>',
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
    `<title>${escapeHtml(title)}</title>`,
    '</head>',
    '<body>',
    '<article>',
    `<h1>${escapeHtml(title)}</h1>`,
    paragraphs,
    '</article>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
