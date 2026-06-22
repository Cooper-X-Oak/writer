import { describe, it, expect } from 'vitest';
import { parseWriteSource } from './provenance.js';

const VALID = { hotspotId: 'hn-abc', sourceType: 'hn', url: 'https://news.ycombinator.com/item?id=1', collectedAt: '2026-06-22T00:00:00.000Z' };

describe('parseWriteSource', () => {
  it('accepts a well-formed source', () => {
    expect(parseWriteSource(VALID)).toEqual(VALID);
  });
  it('rejects when any required field is missing/blank or the wrong type', () => {
    expect(parseWriteSource({ ...VALID, hotspotId: '' })).toBeUndefined();
    expect(parseWriteSource({ ...VALID, collectedAt: 123 })).toBeUndefined();
    expect(parseWriteSource({ ...VALID, sourceType: 'twitter' })).toBeUndefined(); // not hn/rss
    expect(parseWriteSource({ hotspotId: 'x' })).toBeUndefined(); // missing fields
  });
  it('rejects a non-http(s) url (latent href/redirect sink)', () => {
    expect(parseWriteSource({ ...VALID, url: 'javascript:alert(1)' })).toBeUndefined();
    expect(parseWriteSource({ ...VALID, url: 'file:///etc/passwd' })).toBeUndefined();
    expect(parseWriteSource({ ...VALID, url: 'not a url' })).toBeUndefined();
  });
  it('rejects non-object input', () => {
    expect(parseWriteSource(undefined)).toBeUndefined();
    expect(parseWriteSource(null)).toBeUndefined();
    expect(parseWriteSource('x')).toBeUndefined();
  });
  it('accepts an rss source over https', () => {
    expect(parseWriteSource({ ...VALID, sourceType: 'rss', url: 'http://example.com/a' })?.sourceType).toBe('rss');
  });
});
