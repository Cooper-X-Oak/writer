import { describe, it, expect } from 'vitest';
import { buildManifest, manifestToProject, parseManifest } from './manifest.js';
import { ARTIFACT_FILE } from './paths.js';

const SAMPLE = buildManifest({
  id: 'id1',
  title: '标题',
  topic: '主题',
  createdAt: '2026-06-22T00:00:00.000Z',
});

describe('buildManifest', () => {
  it('fills kind/renderer/entry and keeps the inputs', () => {
    expect(SAMPLE).toEqual({
      id: 'id1',
      title: '标题',
      topic: '主题',
      createdAt: '2026-06-22T00:00:00.000Z',
      kind: 'article',
      renderer: 'html',
      entry: ARTIFACT_FILE,
      stage: 'draft',
    });
  });
});

describe('manifestToProject', () => {
  it('maps to the web-facing Project DTO with the dir', () => {
    expect(manifestToProject(SAMPLE, '/p/id1')).toEqual({
      id: 'id1',
      dir: '/p/id1',
      title: '标题',
      createdAt: '2026-06-22T00:00:00.000Z',
      stage: 'draft',
    });
  });
});

describe('manifest stage', () => {
  it('buildManifest defaults stage to draft and accepts an explicit corpus stage', () => {
    expect(SAMPLE.stage).toBe('draft');
    expect(buildManifest({ id: 'c', title: 't', topic: 't', createdAt: 'now', stage: 'corpus' }).stage).toBe('corpus');
  });
  it('parseManifest reads stage, defaults a legacy manifest (no stage) to draft, drops a bad stage', () => {
    expect(parseManifest(JSON.stringify({ id: 'x', title: 'T', createdAt: 'now', entry: 'a.html', stage: 'corpus' }))?.stage).toBe('corpus');
    expect(parseManifest(JSON.stringify({ id: 'x', title: 'T', createdAt: 'now', entry: 'a.html' }))?.stage).toBe('draft');
    expect(parseManifest(JSON.stringify({ id: 'x', title: 'T', createdAt: 'now', entry: 'a.html', stage: 'bogus' }))?.stage).toBe('draft');
  });
  it('manifestToProject forwards stage onto the Project DTO', () => {
    const m = buildManifest({ id: 'c', title: 't', topic: 't', createdAt: 'now', stage: 'corpus' });
    expect(manifestToProject(m, '/p/c').stage).toBe('corpus');
  });
});

describe('parseManifest', () => {
  it('round-trips a serialized manifest', () => {
    expect(parseManifest(JSON.stringify(SAMPLE))).toEqual(SAMPLE);
  });

  it('defaults topic to title when topic is absent', () => {
    const m = parseManifest(JSON.stringify({ id: 'x', title: 'T', createdAt: 'now', entry: 'a.html' }));
    expect(m?.topic).toBe('T');
  });

  it('returns undefined on malformed JSON', () => {
    expect(parseManifest('{not json')).toBeUndefined();
  });

  it('returns undefined when required fields are missing', () => {
    expect(parseManifest(JSON.stringify({ id: 'x' }))).toBeUndefined();
    expect(parseManifest(JSON.stringify({ title: 'x', createdAt: 'now', entry: 'a' }))).toBeUndefined();
  });
});

describe('manifest provenance (source)', () => {
  const source = { hotspotId: 'hn-abc', sourceType: 'hn' as const, url: 'https://x.com/a', collectedAt: '2026-06-22T00:00:00.000Z' };

  it('buildManifest copies a valid source; omits it when absent', () => {
    expect(buildManifest({ id: 'i', title: 't', topic: 't', createdAt: 'now', source }).source).toEqual(source);
    expect('source' in SAMPLE).toBe(false);
  });

  it('parseManifest carries a valid source forward', () => {
    const m = buildManifest({ id: 'i', title: 't', topic: 't', createdAt: 'now', source });
    expect(parseManifest(JSON.stringify(m))?.source).toEqual(source);
  });

  it('parseManifest drops a malformed source (e.g. non-http url) but still parses the rest', () => {
    const raw = JSON.stringify({ id: 'i', title: 't', createdAt: 'now', entry: 'a.html', source: { ...source, url: 'javascript:1' } });
    const m = parseManifest(raw);
    expect(m).toBeDefined();
    expect(m?.source).toBeUndefined();
  });

  it('an old manifest with no source still parses (backward compatible)', () => {
    const m = parseManifest(JSON.stringify({ id: 'i', title: 't', createdAt: 'now', entry: 'a.html' }));
    expect(m).toBeDefined();
    expect(m?.source).toBeUndefined();
  });

  it('manifestToProject forwards a present source onto the Project DTO, omits it when absent', () => {
    const m = buildManifest({ id: 'i', title: 't', topic: 't', createdAt: 'now', source });
    expect(manifestToProject(m, '/p/i').source).toEqual(source);
    expect('source' in manifestToProject(SAMPLE, '/p/x')).toBe(false);
  });
});
