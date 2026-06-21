import { describe, it, expect } from 'vitest';
import { escapeHtml, buildArticleHtml } from './render.js';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });
});

describe('buildArticleHtml', () => {
  it('produces a standalone document with the title in <title> and <h1>', () => {
    const html = buildArticleHtml('我的标题', '第一段。');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>我的标题</title>');
    expect(html).toContain('<h1>我的标题</h1>');
  });

  it('splits blank-line-separated blocks into paragraphs and single newlines into <br/>', () => {
    const html = buildArticleHtml('t', 'a\nb\n\nc');
    expect(html).toContain('<p>a<br/>b</p>');
    expect(html).toContain('<p>c</p>');
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
});
