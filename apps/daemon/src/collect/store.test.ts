import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHotspotStore, parseHotspotSnapshot } from './store.js';
import type { HotspotSnapshot } from '@app/contracts';

let dir: string;
let filePath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hsw-hotspots-'));
  filePath = join(dir, 'sub', 'hotspots.json'); // nested → exercises mkdir recursive
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SNAP: HotspotSnapshot = {
  collectedAt: '2026-06-22T00:00:00.000Z',
  hotspots: [
    { id: 'hn-abc', sourceType: 'hn', title: 'T', url: 'https://x/1', excerpt: '', publishedAt: null, fetchedAt: '2026-06-22T00:00:00.000Z', score: 0.5 },
  ],
};

describe('parseHotspotSnapshot', () => {
  it('round-trips a valid snapshot and rejects malformed/incomplete JSON', () => {
    expect(parseHotspotSnapshot(JSON.stringify(SNAP))).toEqual(SNAP);
    expect(parseHotspotSnapshot('{ not json')).toBeUndefined();
    expect(parseHotspotSnapshot('{"collectedAt":"x"}')).toBeUndefined(); // no hotspots array
    expect(parseHotspotSnapshot('null')).toBeUndefined();
  });
});

describe('HotspotStore', () => {
  it('save writes atomically (no .tmp leftovers), pretty-printed + trailing newline', async () => {
    const store = createHotspotStore({ filePath });
    await store.save(SNAP);
    const files = await readdir(join(dir, 'sub'));
    expect(files).toContain('hotspots.json');
    expect(files.every((f) => !f.endsWith('.tmp'))).toBe(true);
    const raw = await readFile(filePath, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('\n  "collectedAt"'); // 2-space pretty print
  });

  it('save then read round-trips via the injected filePath', async () => {
    const store = createHotspotStore({ filePath });
    await store.save(SNAP);
    expect(await store.read()).toEqual(SNAP);
  });

  it('read of a missing file returns undefined (not a throw)', async () => {
    expect(await createHotspotStore({ filePath }).read()).toBeUndefined();
  });

  it('read of a corrupt file returns undefined', async () => {
    const store = createHotspotStore({ filePath });
    await store.save(SNAP);
    await writeFile(filePath, '{ truncated', 'utf8');
    expect(await store.read()).toBeUndefined();
  });
});
