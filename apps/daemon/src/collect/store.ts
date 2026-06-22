// hotspots.json persistence. Atomic write (temp + rename, same dir → crash-safe, no half file) and
// a tolerant read that returns undefined on missing/corrupt JSON (a bad file = "no data", never a
// crash). The file path is injectable so tests never touch the real dataDir.

import { mkdir, writeFile, rename, readFile, rm } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { HotspotSnapshot } from '@app/contracts';
import { hotspotsPath } from '../workspace/paths.js';

export interface HotspotStore {
  /** The persisted snapshot, or undefined if the file is missing/empty/corrupt. */
  read(): Promise<HotspotSnapshot | undefined>;
  save(snapshot: HotspotSnapshot): Promise<void>;
}

export interface HotspotStoreDeps {
  /** Defaults to dataDir()/hotspots.json. */
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

/** Tolerant parse: returns the snapshot only if the JSON has the expected top-level shape. */
export function parseHotspotSnapshot(json: string): HotspotSnapshot | undefined {
  let o: unknown;
  try {
    o = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof o !== 'object' || o === null) return undefined;
  const rec = o as Record<string, unknown>;
  if (typeof rec.collectedAt !== 'string' || !Array.isArray(rec.hotspots)) return undefined;
  return { collectedAt: rec.collectedAt, hotspots: rec.hotspots as HotspotSnapshot['hotspots'] };
}

export function createHotspotStore(deps: HotspotStoreDeps = {}): HotspotStore {
  const filePath = deps.filePath ?? hotspotsPath();
  return {
    async read() {
      try {
        return parseHotspotSnapshot(await readFile(filePath, 'utf8'));
      } catch {
        return undefined; // missing file → no data
      }
    },
    async save(snapshot) {
      await atomicWrite(filePath, `${JSON.stringify(snapshot, null, 2)}\n`);
    },
  };
}

export const defaultHotspotStore: HotspotStore = createHotspotStore();
