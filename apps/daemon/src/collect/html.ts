// Pure, deterministic text helpers shared by the feed/HN adapters. These are TEXT NORMALIZATION,
// NOT a security boundary — the security boundary is escapeHtml at render time (workspace/render.ts)
// and React's default text escaping. Order is load-bearing: decode entities FIRST, then strip tags
// (never strip-then-decode, which could reconstruct a tag from `&lt;script&gt;`). All regexes are
// single-pass char-class patterns with no nested quantifiers/backreferences (ReDoS-safe).

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
  reg: '®',
};

const ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]+);/g;

/** Decode the named + numeric HTML entities feeds actually use, in a single pass (no double-decode). */
export function decodeEntities(s: string): string {
  return s.replace(ENTITY, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? safeFromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? safeFromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

function safeFromCodePoint(code: number): string {
  if (code <= 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Remove HTML tags and collapse runs of whitespace to a single space, trimmed. */
export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Cap to `max` characters (no trailing partial markup; ellipsis kept within budget). */
export function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Build a plain-text excerpt from a raw (possibly HTML/entity-encoded) source body. */
export function cleanExcerpt(raw: string | undefined, max = 280): string {
  if (!raw) return '';
  return truncate(stripHtml(decodeEntities(raw)), max);
}
