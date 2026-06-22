import { describe, it, expect } from 'vitest';
import { parseCard, parseCards } from './parse.js';
import type { MaterialCard } from '@app/contracts';

const linkRaw = {
  id: 'a', kind: 'link', origin: 'manual', klass: '原始', confidence: 1, tags: [], note: '',
  addedAt: '2026-06-22T00:00:00.000Z', content: { url: 'https://example.com/x', excerpt: 'hi' },
};

describe('parseCard', () => {
  it('accepts a well-formed link card', () => {
    const c = parseCard(linkRaw);
    expect(c?.kind).toBe('link');
    expect((c as Extract<MaterialCard, { kind: 'link' }>).content.url).toBe('https://example.com/x');
  });

  it('rejects missing id / bad kind / bad klass / non-string addedAt', () => {
    expect(parseCard({ ...linkRaw, id: '' })).toBeUndefined();
    expect(parseCard({ ...linkRaw, kind: 'bogus' })).toBeUndefined();
    expect(parseCard({ ...linkRaw, klass: 'X' })).toBeUndefined();
    expect(parseCard({ ...linkRaw, addedAt: 5 })).toBeUndefined();
    expect(parseCard(null)).toBeUndefined();
  });

  it('drops a link card whose url is loopback/unfetchable (SSRF guard on read)', () => {
    expect(parseCard({ ...linkRaw, content: { url: 'http://127.0.0.1/x', excerpt: '' } })).toBeUndefined();
    expect(parseCard({ ...linkRaw, content: { url: 'http://localhost/x', excerpt: '' } })).toBeUndefined();
    expect(parseCard({ ...linkRaw, content: { url: 'not a url', excerpt: '' } })).toBeUndefined();
  });

  it('keeps a text card but drops a bad source.url (granular SSRF)', () => {
    const c = parseCard({
      id: 't', kind: 'text', origin: 'manual', klass: '原始', confidence: 1, tags: [], note: '',
      addedAt: 'now', content: { body: 'b' }, source: { url: 'http://169.254.169.254/', title: 'keep' },
    });
    expect(c?.kind).toBe('text');
    expect(c?.source?.url).toBeUndefined();
    expect(c?.source?.title).toBe('keep');
  });

  it('validates image filename (traversal) + contentType (no svg)', () => {
    const img = { id: 'i', kind: 'image', origin: 'manual', klass: '原始', confidence: 1, tags: [], note: '', addedAt: 'now' };
    expect(parseCard({ ...img, content: { filename: 'a.png', alt: '', contentType: 'image/png' } })?.kind).toBe('image');
    expect(parseCard({ ...img, content: { filename: '../x.png', alt: '', contentType: 'image/png' } })).toBeUndefined();
    expect(parseCard({ ...img, content: { filename: 'a.svg', alt: '', contentType: 'image/svg+xml' } })).toBeUndefined();
  });

  it('accepts md/text/code and clamps confidence + coerces tags', () => {
    expect(parseCard({ id: 'm', kind: 'md', origin: 'manual', klass: '补充', confidence: 9, tags: ['x', 2], note: '', addedAt: 'n', content: { body: '# h' } }))
      .toMatchObject({ kind: 'md', confidence: 1, tags: ['x'] });
    expect(parseCard({ id: 'c', kind: 'code', origin: 'manual', klass: '对比', confidence: -1, tags: 'nope', note: '', addedAt: 'n', content: { snippet: 'x', language: 'ts' } }))
      .toMatchObject({ kind: 'code', confidence: 0, tags: [] });
  });
});

describe('parseCards', () => {
  it('reads the {cards} envelope and a bare array', () => {
    expect(parseCards(JSON.stringify({ cards: [linkRaw] }))).toHaveLength(1);
    expect(parseCards(JSON.stringify([linkRaw]))).toHaveLength(1);
  });
  it('returns [] on bad JSON and drops malformed elements', () => {
    expect(parseCards('{not json')).toEqual([]);
    expect(parseCards(JSON.stringify({ cards: [linkRaw, { id: 'x' }, null] }))).toHaveLength(1);
  });
});
