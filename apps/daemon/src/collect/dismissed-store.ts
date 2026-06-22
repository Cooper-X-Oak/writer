// Dismissed-hotspots sidecar (dismissed.json at the dataDir root). An OVERLAY on the immutable
// hotspots.json snapshot: GET /hotspots filters out dismissed ids at read time, so a refresh
// (which overwrites hotspots.json wholesale) never loses dismissals. Keyed by the deterministic
// stable hotspot id, so a dismissed item keeps filtering across refreshes. Mirrors HotspotStore.

import { mkdir, writeFile, rename, readFile, rm } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { dismissedPath } from '../workspace/paths.js';

export interface DismissedStore {
  /** The set of dismissed hotspot ids; empty set if the file is missing/corrupt. */
  read(): Promise<Set<string>>;
  dismiss(id: string): Promise<void>;
  restore(id: string): Promise<void>;
}

export interface DismissedStoreDeps {
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

/** Tolerant parse: requires `{ids: string[]}`, keeps only string entries; any failure → empty set. */
export function parseDismissed(json: string): Set<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return new Set();
  }
  const ids = typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { ids?: unknown }).ids)
    ? (parsed as { ids: unknown[] }).ids
    : [];
  return new Set(ids.filter((x): x is string => typeof x === 'string'));
}

export function createDismissedStore(deps: DismissedStoreDeps = {}): DismissedStore {
  const filePath = deps.filePath ?? dismissedPath();
  async function read(): Promise<Set<string>> {
    try {
      return parseDismissed(await readFile(filePath, 'utf8'));
    } catch {
      return new Set();
    }
  }
  async function write(set: Set<string>): Promise<void> {
    await atomicWrite(filePath, `${JSON.stringify({ ids: [...set] }, null, 2)}\n`);
  }
  return {
    read,
    async dismiss(id) {
      const set = await read();
      if (set.has(id)) return; // idempotent
      set.add(id);
      await write(set);
    },
    async restore(id) {
      const set = await read();
      if (!set.delete(id)) return; // absent → no-op
      await write(set);
    },
  };
}

export const defaultDismissedStore: DismissedStore = createDismissedStore();
