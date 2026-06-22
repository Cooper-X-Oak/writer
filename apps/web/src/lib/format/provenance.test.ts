import { describe, it, expect } from 'vitest';
import { sourceLabel, hostnameOf } from './provenance';

describe('sourceLabel', () => {
  it('maps source types to short labels', () => {
    expect(sourceLabel('hn')).toBe('HN');
    expect(sourceLabel('rss')).toBe('RSS');
  });
});

describe('hostnameOf', () => {
  it('returns the hostname of a valid http(s) URL', () => {
    expect(hostnameOf('https://news.ycombinator.com/item?id=1')).toBe('news.ycombinator.com');
    expect(hostnameOf('http://blog.example.org/a/b')).toBe('blog.example.org');
  });
  it('falls back to the raw string when the URL does not parse', () => {
    expect(hostnameOf('not a url')).toBe('not a url');
  });
});
