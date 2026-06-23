// GLOBAL planning-desk inbox (策划台收件箱). A single inbox.json at the data-dir root + an
// inbox-images/ blob dir — project-INDEPENDENT staging, the sibling of hotspots.json/feeds.json.
// Mirrors materials-store.ts (atomic temp+rename, tolerant parseCards read, content-addressed blobs
// written FIRST / index LAST) but with NO projectId and NO projectExists guard: the inbox is global,
// so it can never create a phantom project. Promote (corpus.ts) moves items into a per-project corpus.

import { mkdir, writeFile, rename, readFile, rm } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import type { MaterialCard } from '@app/contracts';
import { inboxPath, inboxImagesDir, isSafeImageName } from '../workspace/paths.js';
import { parseCards } from '../corpus/parse.js';
import { imageCard } from '../corpus/normalize.js';

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

/** Inbox cap (bounds the file + the read-time reparse). Same rationale as MAX_CARDS. */
export const MAX_INBOX = 200;

export interface InboxStore {
  list(): Promise<MaterialCard[]>;
  /** Upsert by id (replace if present, else append) — keeps a re-clipped hotspot idempotent. */
  addCard(card: MaterialCard): Promise<MaterialCard | undefined>;
  addImage(bytes: Buffer, contentType: string, alt: string): Promise<MaterialCard | undefined>;
  readImage(filename: string): Promise<{ bytes: Buffer; contentType: string } | undefined>;
  remove(cardId: string): Promise<{ id: string } | undefined>;
}

export interface InboxStoreDeps {
  /** inbox.json path; defaults to dataDir()/inbox.json. */
  file?: string;
  /** inbox image dir; defaults to dataDir()/inbox-images/. */
  imagesDir?: string;
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

export function createInboxStore(deps: InboxStoreDeps = {}): InboxStore {
  const file = deps.file ?? inboxPath();
  const imgDir = deps.imagesDir ?? inboxImagesDir();

  async function readItems(): Promise<MaterialCard[]> {
    try {
      return parseCards(await readFile(file, 'utf8'));
    } catch {
      return []; // missing file → empty inbox
    }
  }

  async function writeItems(items: MaterialCard[]): Promise<void> {
    await atomicWriteText(file, `${JSON.stringify({ cards: items }, null, 2)}\n`);
  }

  /** Replace-by-id or append (capped). Returns undefined when a NEW item would exceed MAX_INBOX. */
  async function upsert(card: MaterialCard): Promise<MaterialCard | undefined> {
    const items = await readItems();
    const i = items.findIndex((c) => c.id === card.id);
    let next: MaterialCard[];
    if (i >= 0) {
      next = items.map((c, idx) => (idx === i ? card : c));
    } else {
      if (items.length >= MAX_INBOX) return undefined;
      next = [...items, card];
    }
    await writeItems(next);
    return card;
  }

  return {
    list() {
      return readItems();
    },

    addCard(card) {
      return upsert(card);
    },

    async addImage(bytes, contentType, alt) {
      const ext = IMAGE_EXT_BY_TYPE[contentType];
      if (!ext) return undefined; // unsupported / disallowed type (no svg)
      const filename = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${ext}`;
      await atomicWriteBuffer(join(imgDir, filename), bytes); // blob FIRST
      const card = imageCard({ filename, contentType, alt }, { now: deps.now, genId: deps.genId });
      return upsert(card); // index LAST
    },

    async readImage(filename) {
      if (!isSafeImageName(filename)) return undefined;
      const ext = filename.split('.').pop() ?? '';
      const contentType = IMAGE_TYPE_BY_EXT[ext];
      if (!contentType) return undefined;
      try {
        return { bytes: await readFile(join(imgDir, filename)), contentType };
      } catch {
        return undefined;
      }
    },

    async remove(cardId) {
      const items = await readItems();
      await writeItems(items.filter((c) => c.id !== cardId)); // idempotent (force-style)
      return { id: cardId };
    },
  };
}

export const defaultInboxStore: InboxStore = createInboxStore();
