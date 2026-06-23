import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { MaterialCard, Project, Hotspot } from '@app/contracts';
import { createCorpusRouter, type CorpusRouterDeps } from './corpus.js';
import type { MaterialsStore } from '../corpus/materials-store.js';
import type { InboxStore } from '../inbox/inbox-store.js';
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
    importCard: (_id, card) => { cards = [...cards.filter((c) => c.id !== card.id), card]; return Promise.resolve(card); },
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

function hs(over: Partial<Hotspot>): Hotspot {
  return { id: 'h', sourceType: 'hn', title: 't', url: 'https://x.com/h', excerpt: '', publishedAt: null, fetchedAt: 'now', score: 0.5, ...over };
}
// A seed about "Rust async runtime" plus two overlapping candidates and one unrelated.
const INQUIRY_SNAPSHOT: Hotspot[] = [
  hs({ id: 'seed', title: 'Rust async runtime', url: 'https://seed.com/x' }),
  hs({ id: 'm1', title: 'New Rust async scheduler', url: 'https://a.com/1' }),
  hs({ id: 'm2', title: 'async runtime internals in Rust', url: 'https://b.com/2' }),
  hs({ id: 'pasta', title: 'best pasta recipe', url: 'https://c.com/3' }),
];
const inquiryHotspotStore: HotspotStore = {
  read: () => Promise.resolve({ collectedAt: 'now', hotspots: INQUIRY_SNAPSHOT }),
  save: () => Promise.resolve(),
};

const json = (method: string, url: string, body: unknown) =>
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function memInbox(init: MaterialCard[] = []): InboxStore {
  let items = [...init];
  return {
    list: () => Promise.resolve([...items]),
    addCard: (card) => { items = [...items.filter((c) => c.id !== card.id), card]; return Promise.resolve(card); },
    addImage: () => Promise.resolve(undefined),
    readImage: () => Promise.resolve({ bytes: Buffer.from([1, 2]), contentType: 'image/png' }),
    remove: (cardId) => { items = items.filter((c) => c.id !== cardId); return Promise.resolve({ id: cardId }); },
  };
}
const inboxCard = (id: string): MaterialCard => ({ id, kind: 'text', origin: 'manual', klass: '原始', confidence: 1, tags: [], note: '', addedAt: 'now', content: { body: id } });

describe('POST /api/cases (lazy/explicit 立项)', () => {
  it('requires a non-empty title (no phantom) and creates a project when given one', async () => {
    const { url, close } = await serve({ projectStore: fakeProjectStore });
    try {
      expect((await json('POST', `${url}/cases`, {})).status).toBe(400);
      expect((await json('POST', `${url}/cases`, { title: '   ' })).status).toBe(400);
      expect((await json('POST', `${url}/cases`, { title: 'x'.repeat(201) })).status).toBe(400);
      const ok = await json('POST', `${url}/cases`, { title: '远程办公' });
      expect(ok.status).toBe(200);
      expect((await ok.json() as { project: Project }).project).toEqual(PROJECT);
    } finally { close(); }
  });
});

describe('POST /api/projects/:id/materials/promote', () => {
  it('promotes the requested inbox items into the corpus and removes only those that landed', async () => {
    const inbox = memInbox([inboxCard('a'), inboxCard('b'), inboxCard('c')]);
    const { url, close } = await serve({ store: memMaterials(), inboxStore: inbox });
    try {
      const res = await json('POST', `${url}/projects/c1/materials/promote`, { inboxIds: ['a', 'c', 'ghost'] });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { promoted: MaterialCard[]; skipped: string[] };
      expect(body.promoted.map((c) => c.id).sort()).toEqual(['a', 'c']);
      expect((await inbox.list()).map((c) => c.id)).toEqual(['b']); // a,c drained; b stays
    } finally { close(); }
  });

  it('400 without inboxIds; 404 when the project is missing (nothing lands, inbox untouched)', async () => {
    const inbox = memInbox([inboxCard('a')]);
    const missing: MaterialsStore = { ...memMaterials(), importCard: () => Promise.resolve(undefined) };
    const { url, close } = await serve({ store: missing, inboxStore: inbox });
    try {
      expect((await json('POST', `${url}/projects/c1/materials/promote`, {})).status).toBe(400);
      expect((await json('POST', `${url}/projects/c1/materials/promote`, { inboxIds: ['a'] })).status).toBe(404);
      expect((await inbox.list()).map((c) => c.id)).toEqual(['a']); // not lost on failure
    } finally { close(); }
  });
});

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

interface InquiryResp { added: MaterialCard[]; skipped: { url: string; reason: string }[]; usedAgent: boolean }

describe('POST /api/projects/:id/inquiry', () => {
  it('gathers neutral 补充 evidence for a hotspot seed (rule tier, no agent)', async () => {
    const { url, close } = await serve({ store: memMaterials(), hotspotStore: inquiryHotspotStore });
    try {
      const res = await json('POST', `${url}/projects/c1/inquiry`, { hotspotId: 'seed' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as InquiryResp;
      expect(body.usedAgent).toBe(false);
      const ids = body.added.map((c) => c.id).sort();
      expect(ids).toEqual(['hs_m1', 'hs_m2']); // overlapping, not the seed, not pasta
      expect(body.added.every((c) => c.origin === 'auto' && c.klass === '补充' && c.relatedTo?.[0] === 'seed')).toBe(true);
    } finally { close(); }
  });

  it('accepts a seedCardId already in the corpus and excludes it from its own candidates', async () => {
    const seedCard: MaterialCard = {
      id: 'card-seed', kind: 'text', origin: 'manual', klass: '原始', confidence: 1, tags: [], note: '',
      addedAt: 'now', content: { body: 'Rust async runtime deep dive' },
    };
    const { url, close } = await serve({ store: memMaterials([seedCard]), hotspotStore: inquiryHotspotStore });
    try {
      const res = await json('POST', `${url}/projects/c1/inquiry`, { seedCardId: 'card-seed' });
      const body = (await res.json()) as InquiryResp;
      expect(body.added.map((c) => c.id).sort()).toEqual(['hs_m1', 'hs_m2', 'hs_seed']);
    } finally { close(); }
  });

  it('applies an injected agent classifier when useAgent is set', async () => {
    const classifier = {
      classify: (_seed: unknown, cands: { hotspot: Hotspot }[]) =>
        Promise.resolve(cands.map((_c, i) => ({ index: i, klass: '对比' as const, stance: 'contradict' as const, confidence: 0.9, note: '反驳' }))),
    };
    const { url, close } = await serve({ store: memMaterials(), hotspotStore: inquiryHotspotStore, classifier });
    try {
      const res = await json('POST', `${url}/projects/c1/inquiry`, { hotspotId: 'seed', useAgent: true });
      const body = (await res.json()) as InquiryResp;
      expect(body.usedAgent).toBe(true);
      expect(body.added.every((c) => c.klass === '对比' && c.stance === 'contradict')).toBe(true);
    } finally { close(); }
  });

  it('accepts a free query as the seed (no relatedTo back-link)', async () => {
    const { url, close } = await serve({ store: memMaterials(), hotspotStore: inquiryHotspotStore });
    try {
      const res = await json('POST', `${url}/projects/c1/inquiry`, { query: 'Rust async runtime' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as InquiryResp;
      expect(body.added.map((c) => c.id).sort()).toEqual(['hs_m1', 'hs_m2', 'hs_seed']);
      expect(body.added.every((c) => c.relatedTo === undefined)).toBe(true); // query seed → no back-link
    } finally { close(); }
  });

  it('200 with empty added when a valid seed yields no overlapping candidates', async () => {
    const { url, close } = await serve({ store: memMaterials(), hotspotStore: inquiryHotspotStore });
    try {
      const res = await json('POST', `${url}/projects/c1/inquiry`, { query: 'sourdough baking' });
      expect(res.status).toBe(200);
      expect((await res.json()) as InquiryResp).toEqual({ added: [], skipped: [], usedAgent: false });
    } finally { close(); }
  });

  it('400 without a valid seed; 400 for an unknown hotspot seed', async () => {
    const { url, close } = await serve({ store: memMaterials(), hotspotStore: inquiryHotspotStore });
    try {
      expect((await json('POST', `${url}/projects/c1/inquiry`, {})).status).toBe(400);
      expect((await json('POST', `${url}/projects/c1/inquiry`, { hotspotId: 'ghost' })).status).toBe(400);
    } finally { close(); }
  });

  it('404 when candidates exist but the project is missing (addCard rejects all)', async () => {
    const missing: MaterialsStore = { ...memMaterials(), addCard: () => Promise.resolve(undefined) };
    const { url, close } = await serve({ store: missing, hotspotStore: inquiryHotspotStore });
    try {
      expect((await json('POST', `${url}/projects/c1/inquiry`, { hotspotId: 'seed' })).status).toBe(404);
    } finally { close(); }
  });
});
