import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeTempSystemPrompt } from './sysprompt-file.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hsw-sp-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeTempSystemPrompt', () => {
  it('writes the content to a .md file under the given dir', async () => {
    const sp = await writeTempSystemPrompt('SYSTEM PROMPT BODY', dir);
    expect(sp.path.startsWith(dir)).toBe(true);
    expect(sp.path.endsWith('.md')).toBe(true);
    expect(await readFile(sp.path, 'utf8')).toBe('SYSTEM PROMPT BODY');
  });

  it('cleanup() removes the file and is idempotent', async () => {
    const sp = await writeTempSystemPrompt('x', dir);
    sp.cleanup();
    // allow the async rm to settle
    await new Promise((r) => setTimeout(r, 20));
    expect(await readdir(dir)).toEqual([]);
    expect(() => sp.cleanup()).not.toThrow(); // second call is a no-op
  });
});
