// Persisted user RSS feed list (feeds.json at the dataDir root). Mirrors HotspotStore: atomic write
// (temp + rename), tolerant read. SECURITY: feeds.json is hand-editable → untrusted on READ too, so
// parseFeedList re-runs the SSRF/dedupe/cap normalizer; a poisoned file can never inject a private/
// non-http target or unbounded fan-out. A bad/missing file degrades to [] (no feeds), never a throw.

import { mkdir, writeFile, rename, readFile, rm } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { feedsPath } from '../workspace/paths.js';
import { normalizeFeeds } from './feed-normalize.js';

export interface FeedsStore {
  /** The persisted, normalized (validated/deduped/capped) feed URLs; [] if missing/corrupt. */
  read(): Promise<string[]>;
  save(urls: string[]): Promise<void>;
}

export interface FeedsStoreDeps {
  /** Defaults to dataDir()/feeds.json. */
  filePath?: string;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  const name = basename(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
  await writeFile(tmp, content, 'utf8');
  try {
    await rename(tmp, filePath);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Tolerant parse: accepts `{urls:string[]}` or a bare `string[]`; re-normalizes (validate/dedupe/
 *  cap) so a hand-edited file is bounded + SSRF-safe; any failure → []. */
export function parseFeedList(json: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { urls?: unknown }).urls)
      ? (parsed as { urls: unknown[] }).urls
      : [];
  return normalizeFeeds(raw.filter((u): u is string => typeof u === 'string'));
}

export function createFeedsStore(deps: FeedsStoreDeps = {}): FeedsStore {
  const filePath = deps.filePath ?? feedsPath();
  return {
    async read() {
      try {
        return parseFeedList(await readFile(filePath, 'utf8'));
      } catch {
        return []; // missing file → no feeds
      }
    },
    async save(urls) {
      await atomicWrite(filePath, `${JSON.stringify({ urls: normalizeFeeds(urls) }, null, 2)}\n`);
    },
  };
}

export const defaultFeedsStore: FeedsStore = createFeedsStore();
