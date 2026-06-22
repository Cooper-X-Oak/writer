import { describe, it, expect } from 'vitest';
import { escapeHtml, buildArticleHtml, splitBlocks, blockIdToIndex, patchBody, imageBlockMarkdown } from './render.js';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });
});

describe('splitBlocks', () => {
  it('splits on blank lines and trims, dropping empties', () => {
    expect(splitBlocks('  a \n\n b \n\n\n c ')).toEqual(['a', 'b', 'c']);
    expect(splitBlocks('')).toEqual([]);
  });
});

describe('blockIdToIndex', () => {
  it('parses b<N> and rejects junk', () => {
    expect(blockIdToIndex('b0')).toBe(0);
    expect(blockIdToIndex('b12')).toBe(12);
    expect(blockIdToIndex('title')).toBeUndefined();
    expect(blockIdToIndex('b')).toBeUndefined();
    expect(blockIdToIndex('bx')).toBeUndefined();
  });
});

describe('patchBody', () => {
  it('replaces one block by index, leaving others intact', () => {
    expect(patchBody('a\n\nb\n\nc', 1, 'B!')).toBe('a\n\nB!\n\nc');
  });
  it('returns the body unchanged for an out-of-range index', () => {
    expect(patchBody('a\n\nb', 5, 'x')).toBe('a\n\nb');
    expect(patchBody('a\n\nb', -1, 'x')).toBe('a\n\nb');
  });
});

describe('buildArticleHtml', () => {
  it('produces a standalone document with the title in <title> and <h1>', () => {
    const html = buildArticleHtml('我的标题', '第一段。');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>我的标题</title>');
    expect(html).toContain('<h1>我的标题</h1>');
  });

  it('tags each paragraph with a stable data-block id; single newlines become <br/>', () => {
    const html = buildArticleHtml('t', 'a\nb\n\nc');
    expect(html).toContain('<p data-block="b0">a<br/>b</p>');
    expect(html).toContain('<p data-block="b1">c</p>');
  });

  it('escapes model output so injected markup cannot execute', () => {
    const html = buildArticleHtml('t', '<script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes a hostile title too', () => {
    const html = buildArticleHtml('</title><script>x</script>', 'body');
    expect(html).not.toContain('<script>x</script>');
  });

  it('renders an image block as <figure><img> instead of <p>', () => {
    const html = buildArticleHtml('t', 'para one\n\n![一张配图](images/abc.png)');
    expect(html).toContain('<figure data-block="b1"><img src="images/abc.png" alt="一张配图" loading="lazy"/></figure>');
    expect(html).toContain('<p data-block="b0">para one</p>');
  });

  it('escapes alt/src in an image block', () => {
    const html = buildArticleHtml('t', '![a"><script>x</script>](images/x.png)');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&quot;');
  });
});

describe('imageBlockMarkdown', () => {
  it('builds a markdown image block', () => {
    expect(imageBlockMarkdown('images/a.png', '配图')).toBe('![配图](images/a.png)');
  });
  it('strips chars that would break the block shape', () => {
    expect(imageBlockMarkdown('images/a.png', 'a]b[c\nd')).toBe('![a b c d](images/a.png)');
  });
});
