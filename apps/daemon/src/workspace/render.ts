// Article rendering + block model. The agent emits plain text; blank-line-separated blocks are the
// edit unit (one <p>, tagged data-block="bN" where N is the block index). Model output is UNTRUSTED
// for rendering — every dynamic value is HTML-escaped; never inject raw model text into markup.

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

/** Canonical split of a plain-text body into edit blocks (paragraphs). Used both to render
 *  data-block ids and to locate a block for patching, so the two always agree. */
export function splitBlocks(body: string): string[] {
  return body
    .trim()
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

/** Parse a data-block id ("b3") back to its block index, or undefined if malformed. */
export function blockIdToIndex(blockId: string): number | undefined {
  const m = /^b(\d+)$/.exec(blockId);
  if (!m) return undefined;
  return Number(m[1]);
}

/** Replace one block's text by index, returning the new body. Out-of-range index → unchanged. */
export function patchBody(body: string, index: number, newText: string): string {
  const blocks = splitBlocks(body);
  if (index < 0 || index >= blocks.length) return body;
  const next = [...blocks];
  next[index] = newText.trim();
  return next.join('\n\n');
}

/** Wrap a plain-text body into a standalone article document. Each block is a <p data-block="bN">;
 *  single newlines become <br/>. All text is escaped. */
export function buildArticleHtml(title: string, body: string): string {
  const paragraphs = splitBlocks(body)
    .map((block, i) => `<p data-block="b${String(i)}">${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`)
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
