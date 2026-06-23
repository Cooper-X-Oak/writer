import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInboxStore, MAX_INBOX, type InboxStore } from './inbox-store.js';
import { textCard } from '../corpus/normalize.js';

let root: string;
let store: InboxStore;
let inboxFile: string;
const fixedNow = () => new Date('2026-06-23T00:00:00.000Z');
const card = (id: string) => textCard('body', { now: fixedNow, genId: () => id });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'inbox-'));
  inboxFile = join(root, 'inbox.json');
  store = createInboxStore({ file: inboxFile, imagesDir: join(root, 'inbox-images'), now: fixedNow });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('inbox-store round-trip (global, no project)', () => {
  it('is empty before any write (missing file → [])', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('addCard then list returns the card', async () => {
    await store.addCard(card('a'));
    expect((await store.list()).map((c) => c.id)).toEqual(['a']);
  });

  it('upserts by id — re-adding the same id does not duplicate', async () => {
    await store.addCard(card('a'));
    await store.addCard({ ...card('a'), note: 'updated' });
    const items = await store.list();
    expect(items).toHaveLength(1);
    expect(items[0]?.note).toBe('updated');
  });

  it('remove drops the item and is idempotent', async () => {
    await store.addCard(card('a'));
    expect(await store.remove('a')).toEqual({ id: 'a' });
    expect(await store.list()).toEqual([]);
    expect(await store.remove('a')).toEqual({ id: 'a' }); // no throw on absent
  });
});

describe('inbox-store images', () => {
  it('writes the blob and persists the card; readImage returns the bytes; rejects svg', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const c = await store.addImage(bytes, 'image/png', 'alt');
    expect(c?.kind).toBe('image');
    const filename = c && c.kind === 'image' ? c.content.filename : '';
    expect(filename).toMatch(/^[a-f0-9]{16}\.png$/);
    const read = await store.readImage(filename);
    expect(read?.bytes.equals(bytes)).toBe(true);
    expect(read?.contentType).toBe('image/png');
    expect((await store.list()).some((x) => x.id === c?.id)).toBe(true);

    expect(await store.addImage(Buffer.from('x'), 'image/svg+xml', '')).toBeUndefined();
  });
});

describe('inbox-store cap', () => {
  it('rejects a NEW item past MAX_INBOX but still upserts an existing one', async () => {
    const seeded = Array.from({ length: MAX_INBOX }, (_, i) => card(`seed-${i}`));
    await writeFile(inboxFile, JSON.stringify({ cards: seeded }), 'utf8');
    expect(await store.addCard(card('overflow'))).toBeUndefined();
    expect(await store.addCard({ ...card('seed-0'), note: 'still ok' })).toBeDefined();
    // no inbox-images dir was created by card-only writes
    await expect(readdir(join(root, 'inbox-images'))).rejects.toThrow();
  });
});
