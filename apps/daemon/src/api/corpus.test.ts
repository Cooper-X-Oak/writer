import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { MaterialCard, Project, Hotspot } from '@app/contracts';
import { createCorpusRouter, type CorpusRouterDeps } from './corpus.js';
import type { MaterialsStore } from '../corpus/materials-store.js';
import type { ProjectStore } from '../workspace/store.js';
import type { HotspotStore } from '../collect/store.js';

function serve(deps: CorpusRouterDeps): Promise<{ url: string; close: () => void }> {
  const app = express();
  app.use(express.json());
  app.use('/api', createCorpusRouter(deps));
  return new Promise((resolve) => {
    const server: Server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/api`, close: () => server.close() });
    });
  });
}

function memMaterials(init: MaterialCard[] = []): MaterialsStore {
  let cards = [...init];
  return {
    list: () => Promise.resolve([...cards]),
    addCard: (_id, card) => { cards = [...cards.filter((c) => c.id !== card.id), card]; return Promise.resolve(card); },
    addImage: (_id, _bytes, contentType, alt) => {
      const card: MaterialCard = { id: 'img1', kind: 'image', origin: 'manual', klass: '原始', confidence: 1, tags: [], note: '', addedAt: 'now', content: { filename: 'abc.png', alt, contentType } };
      cards = [...cards, card];
      return Promise.resolve(card);
    },
    readImage: () => Promise.resolve({ bytes: Buffer.from([0x89, 0x50]), contentType: 'image/png' }),
    remove: (_id, cardId) => { cards = cards.filter((c) => c.id !== cardId); return Promise.resolve({ id: cardId }); },
  };
}

const PROJECT: Project = { id: 'c1', dir: '/p/c1', title: '未命名资料区', createdAt: 'now', stage: 'corpus' };
const fakeProjectStore = { createCorpus: () => Promise.resolve(PROJECT) } as unknown as ProjectStore;

const HOTSPOT: Hotspot = { id: 'hn-1', sourceType: 'hn', title: 'T', url: 'https://news.ycombinator.com/item?id=1', excerpt: 'e', publishedAt: null, fetchedAt: 'now', score: 0.5 };
const fakeHotspotStore: HotspotStore = {
  read: () => Promise.resolve({ collectedAt: 'now', hotspots: [HOTSPOT] }),
  save: () => Promise.resolve(),
};

const json = (method: string, url: string, body: unknown) =>
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('POST /api/projects/corpus', () => {
  it('creates a corpus-stage project', async () => {
    const { url, close } = await serve({ projectStore: fakeProjectStore });
    try {
      const res = await json('POST', `${url}/projects/corpus`, { title: 'x' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ project: PROJECT });
    } finally { close(); }
  });
});

describe('materials CRUD', () => {
  it('GET lists, POST adds a link/text card, rejects bad kind + a loopback link url', async () => {
    const { url, close } = await serve({ store: memMaterials() });
    try {
      expect(await (await fetch(`${url}/projects/c1/materials`)).json()).toEqual({ cards: [] });

      const link = await json('POST', `${url}/projects/c1/materials`, { kind: 'link', url: 'https://example.com/a', excerpt: 'hi' });
      expect(link.status).toBe(200);
      expect((await link.json() as { card: MaterialCard }).card.kind).toBe('link');

      const text = await json('POST', `${url}/projects/c1/materials`, { kind: 'text', body: 'note' });
      expect((await text.json() as { card: MaterialCard }).card.kind).toBe('text');

      expect((await json('POST', `${url}/projects/c1/materials`, { kind: 'bogus' })).status).toBe(400);
      expect((await json('POST', `${url}/projects/c1/materials`, { kind: 'link', url: 'http://127.0.0.1/x' })).status).toBe(400);
    } finally { close(); }
  });

  it('POST image accepts raw bytes; DELETE returns 204; GET image returns the bytes', async () => {
    const { url, close } = await serve({ store: memMaterials() });
    try {
      const img = await fetch(`${url}/projects/c1/materials/image?alt=cat`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });
      expect(img.status).toBe(200);
      expect((await img.json() as { card: MaterialCard }).card.kind).toBe('image');

      expect((await fetch(`${url}/projects/c1/materials/img1`, { method: 'DELETE' })).status).toBe(204);

      const served = await fetch(`${url}/projects/c1/materials/images/abc.png`);
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toContain('image/png');
    } finally { close(); }
  });

  it('from-hotspot adds the matching hotspot as a card; 404 for an unknown id + 400 without one', async () => {
    const { url, close } = await serve({ store: memMaterials(), hotspotStore: fakeHotspotStore });
    try {
      const ok = await json('POST', `${url}/projects/c1/materials/from-hotspot`, { hotspotId: 'hn-1' });
      expect(ok.status).toBe(200);
      expect((await ok.json() as { card: MaterialCard }).card.id).toBe('hs_hn-1');

      expect((await json('POST', `${url}/projects/c1/materials/from-hotspot`, { hotspotId: 'nope' })).status).toBe(404);
      expect((await json('POST', `${url}/projects/c1/materials/from-hotspot`, {})).status).toBe(400);
    } finally { close(); }
  });
});
