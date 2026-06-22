import { describe, it, expect } from 'vitest';
import { decodeEntities, stripHtml, truncate, cleanExcerpt } from './html.js';

describe('decodeEntities', () => {
  it('decodes named, decimal, and hex entities in one pass', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x27;f&#x27;')).toBe(
      `a & b <c> "d" 'e' 'f'`,
    );
  });
  it('decodes common feed entities (nbsp, mdash, rsquo)', () => {
    expect(decodeEntities('x&nbsp;y &mdash; it&rsquo;s')).toBe('x y — it’s');
  });
  it('leaves unknown/garbage entities untouched and drops invalid code points', () => {
    expect(decodeEntities('&notreal; &bogus;')).toBe('&notreal; &bogus;');
    expect(decodeEntities('&#0; &#x110000;')).toBe(' '); // both invalid → empty, sole space between
  });
  it('does not double-decode (&amp;lt; → &lt;, not <)', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
  });
});

describe('stripHtml', () => {
  it('removes tags and collapses whitespace', () => {
    expect(stripHtml('<p>Hello   <b>world</b></p>')).toBe('Hello world');
  });
  it('handles attributes and self-closing tags', () => {
    expect(stripHtml('a <img src="x"/> b <br> c')).toBe('a b c');
  });
});

describe('truncate', () => {
  it('returns the string unchanged when within max', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });
  it('caps to max chars including the ellipsis', () => {
    const out = truncate('abcdefghij', 5);
    expect(out.length).toBeLessThanOrEqual(5);
    expect(out.endsWith('…')).toBe(true);
  });
  it('returns empty for non-positive max', () => {
    expect(truncate('abc', 0)).toBe('');
  });
});

describe('cleanExcerpt', () => {
  it('returns empty for undefined/empty input', () => {
    expect(cleanExcerpt(undefined)).toBe('');
    expect(cleanExcerpt('')).toBe('');
  });
  it('decodes → strips → truncates to ≤ max (decode-then-strip neutralizes encoded tags)', () => {
    expect(cleanExcerpt('&lt;p&gt;Browsers expose &lt;b&gt;compute shaders&lt;/b&gt; &amp; more.&lt;/p&gt;')).toBe(
      'Browsers expose compute shaders & more.',
    );
  });
  it('honors the max length', () => {
    const out = cleanExcerpt('x'.repeat(500), 280);
    expect(out.length).toBeLessThanOrEqual(280);
  });
});
