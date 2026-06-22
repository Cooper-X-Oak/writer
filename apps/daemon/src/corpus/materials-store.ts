// Per-project material corpus (资料区). One materials.json sidecar per project dir + a
// materials-images/ blob dir. Atomic write (temp+rename), tolerant read (parseCards re-validates an
// untrusted/hand-edited file). isSafeProjectId is the SOLE traversal guard (paths can only resolve
// to a direct child of the projects root). Image bytes are content-addressed (sha256) and written
// FIRST, the materials.json index LAST — a crash leaves at worst a GC-able orphan blob.

import { mkdir, writeFile, rename, readFile, rm } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import type { MaterialCard } from '@app/contracts';
import {
  projectsRoot,
  projectDir,
  materialsPath,
  materialsImagesDir,
  manifestPath,
  isSafeProjectId,
  isSafeImageName,
} from '../workspace/paths.js';
import { parseCards } from './parse.js';
import { imageCard } from './normalize.js';

const IMAGE_EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const IMAGE_TYPE_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** Per-project card cap (bounds the file + the read-time reparse). Analogous to MAX_FEEDS. */
export const MAX_CARDS = 200;

export interface MaterialsStore {
  list(projectId: string): Promise<MaterialCard[]>;
  /** Upsert by id (replace if present, else append) — keeps from-hotspot re-import idempotent. */
  addCard(projectId: string, card: MaterialCard): Promise<MaterialCard | undefined>;
  addImage(projectId: string, bytes: Buffer, contentType: string, alt: string): Promise<MaterialCard | undefined>;
  readImage(projectId: string, filename: string): Promise<{ bytes: Buffer; contentType: string } | undefined>;
  remove(projectId: string, cardId: string): Promise<{ id: string } | undefined>;
}

export interface MaterialsStoreDeps {
  root?: string;
  now?: () => Date;
  genId?: () => string;
}

async function atomicWriteText(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${basename(filePath)}.${randomBytes(6).toString('hex')}.tmp`);
  await writeFile(tmp, content, 'utf8');
  try {
    await rename(tmp, filePath);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

async function atomicWriteBuffer(filePath: string, bytes: Buffer): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${basename(filePath)}.${randomBytes(6).toString('hex')}.tmp`);
  await writeFile(tmp, bytes);
  try {
    await rename(tmp, filePath);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export function createMaterialsStore(deps: MaterialsStoreDeps = {}): MaterialsStore {
  const root = deps.root ?? projectsRoot();

  async function readCards(dir: string): Promise<MaterialCard[]> {
    try {
      return parseCards(await readFile(materialsPath(dir), 'utf8'));
    } catch {
      return []; // missing file → empty corpus
    }
  }

  /** A material write only ever attaches to an EXISTING project (manifest present) — never mkdir a
   *  phantom dir for an arbitrary safe-charset id. */
  async function projectExists(dir: string): Promise<boolean> {
    try {
      await readFile(manifestPath(dir), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  async function writeCards(dir: string, cards: MaterialCard[]): Promise<void> {
    await atomicWriteText(materialsPath(dir), `${JSON.stringify({ cards }, null, 2)}\n`);
  }

  /** Replace-by-id or append (capped). Returns undefined when a NEW card would exceed MAX_CARDS. */
  async function upsert(dir: string, card: MaterialCard): Promise<MaterialCard | undefined> {
    const cards = await readCards(dir);
    const i = cards.findIndex((c) => c.id === card.id);
    let next: MaterialCard[];
    if (i >= 0) {
      next = cards.map((c, idx) => (idx === i ? card : c));
    } else {
      if (cards.length >= MAX_CARDS) return undefined;
      next = [...cards, card];
    }
    await writeCards(dir, next);
    return card;
  }

  return {
    async list(projectId) {
      if (!isSafeProjectId(projectId)) return [];
      return readCards(projectDir(root, projectId));
    },

    async addCard(projectId, card) {
      if (!isSafeProjectId(projectId)) return undefined;
      const dir = projectDir(root, projectId);
      if (!(await projectExists(dir))) return undefined;
      return upsert(dir, card);
    },

    async addImage(projectId, bytes, contentType, alt) {
      if (!isSafeProjectId(projectId)) return undefined;
      const ext = IMAGE_EXT_BY_TYPE[contentType];
      if (!ext) return undefined; // unsupported / disallowed type (no svg)
      const dir = projectDir(root, projectId);
      if (!(await projectExists(dir))) return undefined;
      const filename = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${ext}`;
      await atomicWriteBuffer(join(materialsImagesDir(dir), filename), bytes); // blob FIRST
      const card = imageCard({ filename, contentType, alt }, { now: deps.now, genId: deps.genId });
      return upsert(dir, card); // index LAST
    },

    async readImage(projectId, filename) {
      if (!isSafeProjectId(projectId) || !isSafeImageName(filename)) return undefined;
      const ext = filename.split('.').pop() ?? '';
      const contentType = IMAGE_TYPE_BY_EXT[ext];
      if (!contentType) return undefined;
      try {
        const bytes = await readFile(join(materialsImagesDir(projectDir(root, projectId)), filename));
        return { bytes, contentType };
      } catch {
        return undefined;
      }
    },

    async remove(projectId, cardId) {
      if (!isSafeProjectId(projectId)) return undefined;
      const dir = projectDir(root, projectId);
      if (!(await projectExists(dir))) return undefined;
      const cards = await readCards(dir);
      await writeCards(dir, cards.filter((c) => c.id !== cardId)); // idempotent (force-style)
      return { id: cardId };
    },
  };
}

export const defaultMaterialsStore: MaterialsStore = createMaterialsStore();
