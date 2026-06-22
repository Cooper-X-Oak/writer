import { describe, it, expect } from 'vitest';
import { linkCard, textCard, mdCard, codeCard, imageCard, hotspotToCard, MAX_BODY_LEN } from './normalize.js';
import type { Hotspot } from '@app/contracts';

const deps = { now: () => new Date('2026-06-22T00:00:00.000Z'), genId: () => 'fixed-id' };

describe('manual card builders', () => {
  it('linkCard builds a manual link with a cleaned excerpt; rejects an unfetchable url', () => {
    const c = linkCard({ url: 'https://example.com/a', excerpt: '<b>hi</b>', title: 'T' }, deps);
    expect(c).toMatchObject({ id: 'fixed-id', origin: 'manual', klass: '原始', kind: 'link' });
    expect(c?.content).toMatchObject({ url: 'https://example.com/a', excerpt: 'hi', title: 'T' });
    expect(linkCard({ url: 'http://127.0.0.1/x' }, deps)).toBeUndefined();
  });

  it('text/md/code cap the body and lowercase the language', () => {
    expect(textCard('x'.repeat(MAX_BODY_LEN + 50), deps).content.body.length).toBe(MAX_BODY_LEN);
    expect(mdCard('# h', deps)).toMatchObject({ kind: 'md', content: { body: '# h' } });
    expect(codeCard({ snippet: 'const x=1', language: 'TS' }, deps).content).toMatchObject({ snippet: 'const x=1', language: 'ts' });
  });

  it('imageCard shapes the card around a pre-written filename', () => {
    expect(imageCard({ filename: 'abc.png', contentType: 'image/png', alt: 'a' }, deps).content)
      .toEqual({ filename: 'abc.png', alt: 'a', contentType: 'image/png' });
  });
});

describe('hotspotToCard', () => {
  const h: Hotspot = {
    id: 'hn-1', sourceType: 'hn', title: 'T', url: 'https://news.ycombinator.com/item?id=1',
    excerpt: 'body', author: 'pg', points: 9, commentCount: 3, publishedAt: '2026-06-19T00:00:00.000Z',
    fetchedAt: '2026-06-22T00:00:00.000Z', score: 5,
  };
  it('maps a hotspot to an idempotent auto link card, clamping the (unbounded) score', () => {
    const c = hotspotToCard(h, deps);
    expect(c.id).toBe('hs_hn-1');
    expect(c.origin).toBe('auto');
    expect(c.confidence).toBe(1); // score 5 clamped to [0,1]
    expect(c.source).toMatchObject({ url: h.url, title: 'T', author: 'pg', date: h.publishedAt });
    expect(c.content).toMatchObject({ url: h.url, excerpt: 'body', title: 'T' });
  });
  it('omits absent author/date', () => {
    const c = hotspotToCard({ ...h, author: undefined, publishedAt: null }, deps);
    expect(c.source?.author).toBeUndefined();
    expect(c.source?.date).toBeUndefined();
  });
});
