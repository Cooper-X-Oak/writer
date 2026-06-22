import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFeedsStore, parseFeedList } from './feeds-store.js';

let dir: string;
let filePath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hsw-feeds-'));
  filePath = join(dir, 'sub', 'feeds.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseFeedList (read-time validation — untrusted hand-edited file)', () => {
  it('accepts {urls:[]} and a bare array', () => {
    expect(parseFeedList(JSON.stringify({ urls: ['https://a.com/f'] }))).toEqual(['https://a.com/f']);
    expect(parseFeedList(JSON.stringify(['https://a.com/f']))).toEqual(['https://a.com/f']);
  });
  it('drops poisoned entries (private/loopback/non-http) and non-strings; dedupes; caps', () => {
    const poisoned = JSON.stringify({
      urls: ['http://127.0.0.1/x', 'file:///etc/passwd', 'https://ok.com/f', 'https://ok.com/f', 42],
    });
    expect(parseFeedList(poisoned)).toEqual(['https://ok.com/f']);
  });
  it('returns [] for corrupt JSON or an unexpected shape', () => {
    expect(parseFeedList('{ not json')).toEqual([]);
    expect(parseFeedList('"a string"')).toEqual([]);
    expect(parseFeedList('null')).toEqual([]);
  });
});

describe('FeedsStore', () => {
  it('save writes atomically (no .tmp leftovers) as {urls}, then read round-trips', async () => {
    const store = createFeedsStore({ filePath });
    await store.save(['https://a.com/f', 'https://b.com/f']);
    const files = await readdir(join(dir, 'sub'));
    expect(files).toContain('feeds.json');
    expect(files.every((f) => !f.endsWith('.tmp'))).toBe(true);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({ urls: ['https://a.com/f', 'https://b.com/f'] });
    expect(await store.read()).toEqual(['https://a.com/f', 'https://b.com/f']);
  });

  it('save normalizes (drops an invalid url) before persisting', async () => {
    const store = createFeedsStore({ filePath });
    await store.save(['https://a.com/f', 'http://10.0.0.1/x']);
    expect(await store.read()).toEqual(['https://a.com/f']);
  });

  it('read of a missing file returns [] (not a throw)', async () => {
    expect(await createFeedsStore({ filePath }).read()).toEqual([]);
  });

  it('read of a corrupt file returns []', async () => {
    const store = createFeedsStore({ filePath });
    await store.save(['https://a.com/f']);
    await writeFile(filePath, '{ truncated', 'utf8');
    expect(await store.read()).toEqual([]);
  });
});
