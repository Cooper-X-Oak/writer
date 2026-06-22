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
    });
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
