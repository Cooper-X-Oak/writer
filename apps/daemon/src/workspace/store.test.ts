import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectStore } from './store.js';
import { MANIFEST_FILE, ARTIFACT_FILE } from './paths.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hsw-store-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('ProjectStore', () => {
  it('create() writes the artifact and manifest, returning the Project', async () => {
    const store = createProjectStore({ root, genId: () => 'p1', now: () => new Date('2026-06-22T00:00:00.000Z') });
    const project = await store.create({ topic: '远程办公', body: '正文第一段。\n\n第二段。' });

    expect(project).toEqual({
      id: 'p1',
      dir: join(root, 'p1'),
      title: '远程办公',
      createdAt: '2026-06-22T00:00:00.000Z',
    });
    const files = await readdir(join(root, 'p1'));
    expect(files).toContain(MANIFEST_FILE);
    expect(files).toContain(ARTIFACT_FILE);
    // no leftover temp files from the atomic write
    expect(files.every((f) => !f.endsWith('.tmp'))).toBe(true);

    const html = await store.readArtifact('p1');
    expect(html).toContain('<h1>远程办公</h1>');
    expect(html).toContain('<p data-block="b0">正文第一段。</p>');
  });

  it('list() returns saved projects newest-first', async () => {
    const store = createProjectStore({ root });
    let n = 0;
    const seq = createProjectStore({
      root,
      genId: () => `id${(n += 1)}`,
      now: () => new Date(2026, 0, n), // each create a day later
    });
    await seq.create({ topic: 'first', body: 'a' });
    await seq.create({ topic: 'second', body: 'b' });

    const list = await store.list();
    expect(list.map((p) => p.title)).toEqual(['second', 'first']); // newest first
  });

  it('list() returns [] when the root does not exist yet', async () => {
    const store = createProjectStore({ root: join(root, 'does-not-exist') });
    expect(await store.list()).toEqual([]);
  });

  it('list() skips directories without a readable manifest', async () => {
    const store = createProjectStore({ root, genId: () => 'good', now: () => new Date('2026-06-22T00:00:00.000Z') });
    await store.create({ topic: 'real', body: 'x' });
    await mkdir(join(root, 'junk'), { recursive: true });
    await writeFile(join(root, 'junk', MANIFEST_FILE), '{ not json', 'utf8');

    const list = await store.list();
    expect(list.map((p) => p.id)).toEqual(['good']);
  });

  it('readArtifact() returns undefined for unknown and unsafe ids (no traversal)', async () => {
    const store = createProjectStore({ root });
    expect(await store.readArtifact('nope')).toBeUndefined();
    expect(await store.readArtifact('../../etc/passwd')).toBeUndefined();
    expect(await store.readArtifact('..')).toBeUndefined();
  });

  it('readBody() returns the editable plain-text source', async () => {
    const store = createProjectStore({ root, genId: () => 'p1' });
    await store.create({ topic: 't', body: 'one\n\ntwo' });
    expect((await store.readBody('p1'))?.trim()).toBe('one\n\ntwo');
  });

  it('patchBlock() replaces a block, re-renders, and persists both body + artifact', async () => {
    const store = createProjectStore({ root, genId: () => 'p1' });
    await store.create({ topic: 't', body: 'first para\n\nsecond para' });

    const result = await store.patchBlock('p1', 'b1', '改写后的第二段');
    expect(result?.html).toContain('<p data-block="b1">改写后的第二段</p>');
    expect(result?.html).toContain('<p data-block="b0">first para</p>'); // sibling intact

    // persisted: a fresh read reflects the patch
    expect(await store.readBody('p1')).toContain('改写后的第二段');
    expect(await store.readArtifact('p1')).toContain('改写后的第二段');
  });

  it('patchBlock() escapes the new text (no injection via rewrite)', async () => {
    const store = createProjectStore({ root, genId: () => 'p1' });
    await store.create({ topic: 't', body: 'a\n\nb' });
    const result = await store.patchBlock('p1', 'b0', '<img src=x onerror=alert(1)>');
    expect(result?.html).not.toContain('<img src=x');
    expect(result?.html).toContain('&lt;img src=x');
  });

  it('patchBlock() returns undefined for unknown id, bad blockId, or out-of-range block', async () => {
    const store = createProjectStore({ root, genId: () => 'p1' });
    await store.create({ topic: 't', body: 'only one block' });
    expect(await store.patchBlock('nope', 'b0', 'x')).toBeUndefined();
    expect(await store.patchBlock('p1', 'title', 'x')).toBeUndefined();
    expect(await store.patchBlock('p1', 'b9', 'x')).toBeUndefined();
    expect(await store.patchBlock('../etc', 'b0', 'x')).toBeUndefined();
  });
});
