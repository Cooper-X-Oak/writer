import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  projectsRoot,
  projectDir,
  manifestPath,
  artifactPath,
  createProjectId,
  isSafeProjectId,
  MANIFEST_FILE,
  ARTIFACT_FILE,
} from './paths.js';

describe('workspace paths', () => {
  it('composes the projects root, project dir, and file paths', () => {
    const root = projectsRoot('/base');
    expect(root).toBe(join('/base', 'projects'));
    const dir = projectDir(root, 'abc');
    expect(dir).toBe(join(root, 'abc'));
    expect(manifestPath(dir)).toBe(join(dir, MANIFEST_FILE));
    expect(artifactPath(dir)).toBe(join(dir, ARTIFACT_FILE));
  });
});

describe('createProjectId', () => {
  it('encodes the timestamp so later ids sort after earlier ones', () => {
    const a = createProjectId(1_000_000_000_000);
    const b = createProjectId(1_000_000_000_001);
    expect(a < b).toBe(true);
    expect(a).toMatch(/^[0-9a-z]+-[0-9a-f]{8}$/);
  });

  it('is collision-resistant for the same timestamp (random suffix differs)', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createProjectId(42)));
    expect(ids.size).toBe(50);
  });
});

describe('isSafeProjectId', () => {
  it('accepts generated ids', () => {
    expect(isSafeProjectId(createProjectId(1))).toBe(true);
  });

  it('rejects traversal and path separators', () => {
    expect(isSafeProjectId('..')).toBe(false);
    expect(isSafeProjectId('.')).toBe(false);
    expect(isSafeProjectId('a/b')).toBe(false);
    expect(isSafeProjectId('a\\b')).toBe(false);
    expect(isSafeProjectId('../etc/passwd')).toBe(false);
    expect(isSafeProjectId('')).toBe(false);
  });
});
