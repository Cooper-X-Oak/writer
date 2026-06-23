import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { MaterialCard, Hotspot } from '@app/contracts';
import { createInboxRouter, type InboxRouterDeps } from './inbox.js';
import type { InboxStore } from '../inbox/inbox-store.js';
import type { HotspotStore } from '../collect/store.js';

function serve(deps: InboxRouterDeps): Promise<{ url: string; close: () => void }> {
  const app = express();
  app.use(express.json());
  app.use('/api', createInboxRouter(deps));
  return new Promise((resolve) => {
    const server: Server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/api`, close: () => server.close() });
    });
  });
}

function memInbox(init: MaterialCard[] = []): InboxStore {
  let items = [...init];
  return {
    list: () => Promise.resolve([...items]),
    addCard: (card) => { items = [...items.filter((c) => c.id !== card.id), card]; return Promise.resolve(card); },
    addImage: (_bytes, contentType, alt) => {
      const card: MaterialCard = { id: 'img1', kind: 'image', origin: 'manual', klass: '原始', confidence: 1, tags: [], note: '', addedAt: 'now', content: { filename: 'abc.png', alt, contentType } };
      items = [...items, card];
      return Promise.resolve(card);
    },
    readImage: () => Promise.resolve({ bytes: Buffer.from([0x89, 0x50]), contentType: 'image/png' }),
    remove: (cardId) => { items = items.filter((c) => c.id !== cardId); return Promise.resolve({ id: cardId }); },
  };
}

const HOTSPOT: Hotspot = { id: 'hn-1', sourceType: 'hn', title: 'T', url: 'https://news.ycombinator.com/item?id=1', excerpt: 'e', publishedAt: null, fetchedAt: 'now', score: 0.5 };
const fakeHotspotStore: HotspotStore = {
  read: () => Promise.resolve({ collectedAt: 'now', hotspots: [HOTSPOT] }),
  save: () => Promise.resolve(),
};

const json = (method: string, url: string, body: unknown) =>
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('global inbox routes (no project id)', () => {
  it('GET lists, POST adds a link/text item, rejects bad kind + a loopback link url', async () => {
    const { url, close } = await serve({ store: memInbox() });
    try {
      expect(await (await fetch(`${url}/inbox`)).json()).toEqual({ items: [] });

      const link = await json('POST', `${url}/inbox`, { kind: 'link', url: 'https://example.com/a', excerpt: 'hi' });
      expect(link.status).toBe(200);
      expect((await link.json() as { item: MaterialCard }).item.kind).toBe('link');

      const text = await json('POST', `${url}/inbox`, { kind: 'text', body: 'note' });
      expect((await text.json() as { item: MaterialCard }).item.kind).toBe('text');

      expect((await json('POST', `${url}/inbox`, { kind: 'bogus' })).status).toBe(400);
      expect((await json('POST', `${url}/inbox`, { kind: 'link', url: 'http://127.0.0.1/x' })).status).toBe(400);
    } finally { close(); }
  });

  it('POST image accepts raw bytes; DELETE returns 204; GET image returns the bytes', async () => {
    const { url, close } = await serve({ store: memInbox() });
    try {
      const img = await fetch(`${url}/inbox/image?alt=cat`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });
      expect(img.status).toBe(200);
      expect((await img.json() as { item: MaterialCard }).item.kind).toBe('image');

      expect((await fetch(`${url}/inbox/img1`, { method: 'DELETE' })).status).toBe(204);

      const served = await fetch(`${url}/inbox/images/abc.png`);
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toContain('image/png');
    } finally { close(); }
  });

  it('from-hotspot adds the matching hotspot as an item; 404 unknown + 400 without one', async () => {
    const { url, close } = await serve({ store: memInbox(), hotspotStore: fakeHotspotStore });
    try {
      const ok = await json('POST', `${url}/inbox/from-hotspot`, { hotspotId: 'hn-1' });
      expect(ok.status).toBe(200);
      expect((await ok.json() as { item: MaterialCard }).item.id).toBe('hs_hn-1');

      expect((await json('POST', `${url}/inbox/from-hotspot`, { hotspotId: 'nope' })).status).toBe(404);
      expect((await json('POST', `${url}/inbox/from-hotspot`, {})).status).toBe(400);
    } finally { close(); }
  });
});
