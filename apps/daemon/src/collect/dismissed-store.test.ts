import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDismissedStore, parseDismissed } from './dismissed-store.js';

let dir: string;
let filePath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hsw-dismissed-'));
  filePath = join(dir, 'sub', 'dismissed.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseDismissed', () => {
  it('requires {ids:[]} and keeps only strings; junk → empty set', () => {
    expect([...parseDismissed(JSON.stringify({ ids: ['a', 'b', 7, null] }))]).toEqual(['a', 'b']);
    expect(parseDismissed('{ not json').size).toBe(0);
    expect(parseDismissed(JSON.stringify(['a'])).size).toBe(0); // bare array not accepted
    expect(parseDismissed('null').size).toBe(0);
  });
});

describe('DismissedStore', () => {
  it('dismiss → read round-trips a Set; idempotent; no .tmp leftovers', async () => {
    const store = createDismissedStore({ filePath });
    await store.dismiss('hn-a');
    await store.dismiss('hn-a'); // idempotent
    await store.dismiss('rss-b');
    expect([...(await store.read())].sort()).toEqual(['hn-a', 'rss-b']);
    expect((await readdir(join(dir, 'sub'))).every((f) => !f.endsWith('.tmp'))).toBe(true);
  });

  it('restore removes an id; restoring an absent id is a no-op', async () => {
    const store = createDismissedStore({ filePath });
    await store.dismiss('hn-a');
    await store.restore('hn-a');
    await store.restore('hn-a'); // no-op
    expect((await store.read()).size).toBe(0);
  });

  it('read of a missing file → empty set (not a throw)', async () => {
    expect((await createDismissedStore({ filePath }).read()).size).toBe(0);
  });

  it('read of a corrupt file → empty set', async () => {
    const store = createDismissedStore({ filePath });
    await store.dismiss('hn-a');
    await writeFile(filePath, '{ truncated', 'utf8');
    expect((await store.read()).size).toBe(0);
  });
});
