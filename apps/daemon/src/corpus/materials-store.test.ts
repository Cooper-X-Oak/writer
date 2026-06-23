import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MaterialCard } from '@app/contracts';
import { createMaterialsStore, MAX_CARDS, type MaterialsStore } from './materials-store.js';
import { textCard } from './normalize.js';
import { materialsPath, manifestPath, projectDir } from '../workspace/paths.js';

let root: string;
let store: MaterialsStore;
const fixedNow = () => new Date('2026-06-22T00:00:00.000Z');

/** A material write only attaches to an existing project — seed a manifest for 'p1'. */
async function seedProject(id: string): Promise<void> {
  await mkdir(projectDir(root, id), { recursive: true });
  await writeFile(manifestPath(projectDir(root, id)), `{"id":"${id}"}`, 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'corpus-'));
  store = createMaterialsStore({ root, now: fixedNow });
  await seedProject('p1');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const card = (id: string) => textCard('body', { now: fixedNow, genId: () => id });

describe('materials-store round-trip', () => {
  it('addCard then list returns the card', async () => {
    await store.addCard('p1', card('a'));
    const cards = await store.list('p1');
    expect(cards.map((c) => c.id)).toEqual(['a']);
  });

  it('upserts by id — re-adding the same id does not duplicate', async () => {
    await store.addCard('p1', card('a'));
    await store.addCard('p1', { ...card('a'), note: 'updated' });
    const cards = await store.list('p1');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.note).toBe('updated');
  });

  it('remove drops the card and is idempotent', async () => {
    await store.addCard('p1', card('a'));
    expect(await store.remove('p1', 'a')).toEqual({ id: 'a' });
    expect(await store.list('p1')).toEqual([]);
    expect(await store.remove('p1', 'a')).toEqual({ id: 'a' }); // no throw on absent
  });

  it('rejects a traversal projectId for every method', async () => {
    expect(await store.addCard('../escape', card('a'))).toBeUndefined();
    expect(await store.list('../escape')).toEqual([]);
    expect(await store.remove('../escape', 'a')).toBeUndefined();
  });

  it('refuses to write to a nonexistent project (no phantom dir created)', async () => {
    expect(await store.addCard('ghost', card('a'))).toBeUndefined();
    expect(await store.remove('ghost', 'a')).toBeUndefined();
    expect(await store.addImage('ghost', Buffer.from([1, 2]), 'image/png', '')).toBeUndefined();
    await expect(readdir(projectDir(root, 'ghost'))).rejects.toThrow(); // dir never created
  });
});

describe('materials-store images', () => {
  it('writes the blob and persists the card; readImage returns the bytes', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const c = await store.addImage('p1', bytes, 'image/png', 'alt');
    expect(c?.kind).toBe('image');
    const filename = c && c.kind === 'image' ? c.content.filename : '';
    expect(filename).toMatch(/^[a-f0-9]{16}\.png$/);
    const read = await store.readImage('p1', filename);
    expect(read?.bytes.equals(bytes)).toBe(true);
    expect(read?.contentType).toBe('image/png');
    // the index reflects the blob
    expect((await store.list('p1')).some((x) => x.id === c?.id)).toBe(true);
  });

  it('rejects an unsupported content-type (no svg)', async () => {
    expect(await store.addImage('p1', Buffer.from('x'), 'image/svg+xml', '')).toBeUndefined();
  });
});

describe('materials-store cap', () => {
  it('rejects a NEW card past MAX_CARDS but still upserts an existing one', async () => {
    const seeded = Array.from({ length: MAX_CARDS }, (_, i) => card(`seed-${i}`));
    await mkdir(projectDir(root, 'p1'), { recursive: true });
    await writeFile(materialsPath(projectDir(root, 'p1')), JSON.stringify({ cards: seeded }), 'utf8');
    expect(await store.addCard('p1', card('overflow'))).toBeUndefined();
    expect(await store.addCard('p1', { ...card('seed-0'), note: 'still ok' })).toBeDefined();
  });
});

describe('materials-store importCard (inbox → corpus promote)', () => {
  it('imports a card keeping its id; undefined for a missing project', async () => {
    const c = card('imp');
    expect(await store.importCard('p1', c)).toEqual(c);
    expect((await store.list('p1')).map((x) => x.id)).toContain('imp');
    expect(await store.importCard('ghost', card('x'))).toBeUndefined();
  });

  it('copies the image blob under the card filename so readImage resolves it', async () => {
    const bytes = Buffer.from([1, 2, 3, 4]);
    const img: MaterialCard = {
      id: 'i', kind: 'image', origin: 'manual', klass: '原始', confidence: 1, tags: [], note: '',
      addedAt: 'now', content: { filename: 'deadbeefdeadbeef.png', alt: 'a', contentType: 'image/png' },
    };
    expect((await store.importCard('p1', img, bytes))?.id).toBe('i');
    const read = await store.readImage('p1', 'deadbeefdeadbeef.png');
    expect(read?.bytes.equals(bytes)).toBe(true);
  });
});
