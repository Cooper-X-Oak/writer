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

// A block that is exactly a markdown image — `![alt](src)` — renders as <img> instead of <p>.
const IMAGE_BLOCK = /^!\[([^\]]*)\]\(([^)]+)\)$/;

/** Markdown for an image block, appended to the body as its own block. */
export function imageBlockMarkdown(src: string, alt: string): string {
  // strip the few chars that would break the markdown block shape; src is our own controlled path.
  const safeAlt = alt.replace(/[[\]\n]/g, ' ').trim();
  const safeSrc = src.replace(/[()\s]/g, '');
  return `![${safeAlt}](${safeSrc})`;
}

/** Collect every image-block src in body order (e.g. ["images/abc.png"]). Used by the exporter to
 *  pre-resolve each referenced file to an inline data URI. */
export function collectImageSrcs(body: string): string[] {
  const srcs: string[] = [];
  for (const block of splitBlocks(body)) {
    const img = IMAGE_BLOCK.exec(block);
    if (img?.[2]) srcs.push(img[2]);
  }
  return srcs;
}

/** Maps a stored image src ("images/abc.png") to the src actually emitted in the document.
 *  Identity for the live preview; a data-URI lookup for self-contained export. */
export type ImageSrcResolver = (src: string) => string;

function renderBlock(block: string, i: number, resolveSrc?: ImageSrcResolver): string {
  const id = `b${String(i)}`;
  const img = IMAGE_BLOCK.exec(block);
  if (img) {
    const alt = escapeHtml(img[1] ?? '');
    const rawSrc = img[2] ?? '';
    const src = escapeHtml(resolveSrc ? resolveSrc(rawSrc) : rawSrc);
    return `<figure data-block="${id}"><img src="${src}" alt="${alt}" loading="lazy"/></figure>`;
  }
  return `<p data-block="${id}">${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`;
}

interface DocumentOptions {
  /** Rewrites image srcs (export inlines them as data URIs). Omit for identity. */
  resolveImageSrc?: ImageSrcResolver;
  /** Inline CSS injected into <head> (export embeds readable styling; preview stays unstyled). */
  styleCss?: string;
}

function buildDocument(title: string, body: string, opts: DocumentOptions = {}): string {
  const paragraphs = splitBlocks(body)
    .map((block, i) => renderBlock(block, i, opts.resolveImageSrc))
    .join('\n');
  const head = [
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
    `<title>${escapeHtml(title)}</title>`,
  ];
  if (opts.styleCss) head.push(`<style>${opts.styleCss}</style>`);
  return [
    '<!doctype html>',
    '<html lang="zh">',
    '<head>',
    ...head,
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

/** Wrap a plain-text body into a standalone article document. Each block is a <p data-block="bN">
 *  (or <figure><img> for an image block); single newlines become <br/>. All text is escaped. */
export function buildArticleHtml(title: string, body: string): string {
  return buildDocument(title, body);
}

/** Readable, self-contained styling for exported documents (HTML download / PDF). No external
 *  fonts or assets so the single file renders identically offline. */
export const EXPORT_CSS = [
  'html{-webkit-text-size-adjust:100%}',
  'body{margin:0;background:#fff;color:#1a1a1a;',
  'font-family:"Segoe UI",-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.85}',
  'article{max-width:42rem;margin:0 auto;padding:3.5rem 1.5rem 5rem}',
  'h1{font-size:2rem;line-height:1.25;letter-spacing:-0.01em;margin:0 0 1.75rem}',
  'p{margin:0 0 1.25rem;font-size:1.0625rem}',
  'figure{margin:2rem 0}',
  'img{display:block;max-width:100%;height:auto;border-radius:10px}',
  '@media print{article{padding:0;max-width:none}}',
].join('');

/** Render a fully self-contained article: images inlined as data URIs (via `resolveImageSrc`) and
 *  readable CSS embedded, so the single HTML file opens/prints identically with no daemon. */
export function buildSelfContainedHtml(
  title: string,
  body: string,
  resolveImageSrc: ImageSrcResolver,
): string {
  return buildDocument(title, body, { resolveImageSrc, styleCss: EXPORT_CSS });
}
