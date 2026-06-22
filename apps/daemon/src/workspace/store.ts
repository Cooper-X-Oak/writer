// Project store — filesystem-backed (no SQLite; zero native deps for MVP). Writes are atomic
// (temp file + rename) so a crash mid-write never leaves a half-written manifest/artifact. The
// artifact is written first and the manifest LAST, so manifest presence means "fully committed".

import { mkdir, writeFile, rename, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import type { Project } from '@app/contracts';
import {
  projectsRoot,
  projectDir,
  manifestPath,
  artifactPath,
  bodyPath,
  imagesDir,
  isSafeProjectId,
  isSafeImageName,
  createProjectId,
  ARTIFACT_FILE,
  BODY_FILE,
  IMAGES_DIR,
  MANIFEST_FILE,
} from './paths.js';
import { buildManifest, manifestToProject, parseManifest, type ProjectManifest } from './manifest.js';
import {
  buildArticleHtml,
  buildSelfContainedHtml,
  collectImageSrcs,
  patchBody,
  blockIdToIndex,
  splitBlocks,
  imageBlockMarkdown,
} from './render.js';

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

export interface CreateProjectInput {
  topic: string;
  /** Defaults to the topic. */
  title?: string;
  /** Plain-text draft body; rendered to article.html. */
  body: string;
}

export interface ProjectStore {
  create(input: CreateProjectInput): Promise<Project>;
  list(): Promise<Project[]>;
  /** The rendered article HTML, or undefined if the id is unknown/unsafe. */
  readArtifact(id: string): Promise<string | undefined>;
  /** The editable plain-text body, or undefined if unknown/unsafe. */
  readBody(id: string): Promise<string | undefined>;
  /** Replace one block's text and re-render. Returns the new HTML, or undefined if the id/block is
   *  unknown/unsafe. */
  patchBlock(id: string, blockId: string, text: string): Promise<{ html: string } | undefined>;
  /** Save a generated image, append it as an image block, re-render. Returns the new HTML +
   *  filename, or undefined if the id/content-type is unknown/unsafe. */
  addImage(id: string, input: AddImageInput): Promise<{ html: string; name: string } | undefined>;
  /** Read an image file's bytes + content-type, or undefined if unknown/unsafe. */
  readImage(id: string, name: string): Promise<{ bytes: Buffer; contentType: string } | undefined>;
  /** Render a fully self-contained article (images inlined as data URIs, CSS embedded) for export.
   *  Returns undefined if the id is unknown/unsafe. */
  exportHtml(id: string): Promise<string | undefined>;
}

export interface AddImageInput {
  bytes: Buffer;
  contentType: string;
  /** Alt text / caption (defaults to the topic). */
  alt?: string;
}

export interface StoreDeps {
  /** Projects root directory; defaults to <dataDir>/projects. */
  root?: string;
  genId?: () => string;
  now?: () => Date;
}

async function atomicWrite(dir: string, name: string, content: string): Promise<void> {
  const tmp = join(dir, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
  await writeFile(tmp, content, 'utf8');
  try {
    await rename(tmp, join(dir, name));
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

async function atomicWriteBuffer(dir: string, name: string, bytes: Buffer): Promise<void> {
  const tmp = join(dir, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
  await writeFile(tmp, bytes);
  try {
    await rename(tmp, join(dir, name));
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export function createProjectStore(deps: StoreDeps = {}): ProjectStore {
  const root = deps.root ?? projectsRoot();
  const genId = deps.genId ?? (() => createProjectId());
  const now = deps.now ?? (() => new Date());

  async function loadImage(
    id: string,
    name: string,
  ): Promise<{ bytes: Buffer; contentType: string } | undefined> {
    if (!isSafeProjectId(id) || !isSafeImageName(name)) return undefined;
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const contentType = IMAGE_TYPE_BY_EXT[ext];
    if (!contentType) return undefined;
    try {
      const bytes = await readFile(join(imagesDir(projectDir(root, id)), name));
      return { bytes, contentType };
    } catch {
      return undefined;
    }
  }

  return {
    async create({ topic, title, body }) {
      const id = genId();
      const dir = projectDir(root, id);
      await mkdir(dir, { recursive: true });

      const finalTitle = (title ?? topic).trim() || 'Untitled';
      const manifest: ProjectManifest = buildManifest({
        id,
        title: finalTitle,
        topic,
        createdAt: now().toISOString(),
      });

      // body (editable source) + artifact first, manifest last (the commit marker).
      await atomicWrite(dir, BODY_FILE, `${body.trim()}\n`);
      await atomicWrite(dir, ARTIFACT_FILE, buildArticleHtml(finalTitle, body));
      await atomicWrite(dir, MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
      return manifestToProject(manifest, dir);
    },

    async list() {
      let entries;
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch {
        return []; // root not created yet → no projects
      }
      const projects: Project[] = [];
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const dir = projectDir(root, e.name);
        try {
          const m = parseManifest(await readFile(manifestPath(dir), 'utf8'));
          if (m) projects.push(manifestToProject(m, dir));
        } catch {
          // dir without a readable manifest = incomplete/junk → skip
        }
      }
      // newest first (createdAt is ISO-8601 → lexicographic order matches chronological)
      projects.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
      return projects;
    },

    async readArtifact(id) {
      if (!isSafeProjectId(id)) return undefined;
      try {
        return await readFile(artifactPath(projectDir(root, id)), 'utf8');
      } catch {
        return undefined;
      }
    },

    async readBody(id) {
      if (!isSafeProjectId(id)) return undefined;
      try {
        return await readFile(bodyPath(projectDir(root, id)), 'utf8');
      } catch {
        return undefined;
      }
    },

    async patchBlock(id, blockId, text) {
      if (!isSafeProjectId(id)) return undefined;
      const index = blockIdToIndex(blockId);
      if (index === undefined) return undefined;
      const dir = projectDir(root, id);
      let body: string;
      let manifest: ProjectManifest | undefined;
      try {
        body = await readFile(bodyPath(dir), 'utf8');
        manifest = parseManifest(await readFile(manifestPath(dir), 'utf8'));
      } catch {
        return undefined;
      }
      if (!manifest || index >= splitBlocks(body).length) return undefined;

      const nextBody = patchBody(body, index, text);
      const html = buildArticleHtml(manifest.title, nextBody);
      // body (source) then artifact (derived) — both atomic.
      await atomicWrite(dir, BODY_FILE, `${nextBody.trim()}\n`);
      await atomicWrite(dir, ARTIFACT_FILE, html);
      return { html };
    },

    async addImage(id, { bytes, contentType, alt }) {
      if (!isSafeProjectId(id)) return undefined;
      const ext = IMAGE_EXT_BY_TYPE[contentType];
      if (!ext) return undefined; // unsupported content-type
      const dir = projectDir(root, id);
      let body: string;
      let manifest: ProjectManifest | undefined;
      try {
        body = await readFile(bodyPath(dir), 'utf8');
        manifest = parseManifest(await readFile(manifestPath(dir), 'utf8'));
      } catch {
        return undefined;
      }
      if (!manifest) return undefined;

      const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${ext}`;
      await mkdir(imagesDir(dir), { recursive: true });
      await atomicWriteBuffer(imagesDir(dir), name, bytes);

      const block = imageBlockMarkdown(`${IMAGES_DIR}/${name}`, alt ?? manifest.topic);
      const nextBody = `${body.trim()}\n\n${block}`;
      const html = buildArticleHtml(manifest.title, nextBody);
      await atomicWrite(dir, BODY_FILE, `${nextBody.trim()}\n`);
      await atomicWrite(dir, ARTIFACT_FILE, html);
      return { html, name };
    },

    async readImage(id, name) {
      return loadImage(id, name);
    },

    async exportHtml(id) {
      if (!isSafeProjectId(id)) return undefined;
      const dir = projectDir(root, id);
      let body: string;
      let manifest: ProjectManifest | undefined;
      try {
        body = await readFile(bodyPath(dir), 'utf8');
        manifest = parseManifest(await readFile(manifestPath(dir), 'utf8'));
      } catch {
        return undefined;
      }
      if (!manifest) return undefined;

      // Pre-resolve every referenced image to a data URI (the renderer's resolver is sync).
      const dataUris = new Map<string, string>();
      const prefix = `${IMAGES_DIR}/`;
      for (const src of collectImageSrcs(body)) {
        if (dataUris.has(src) || !src.startsWith(prefix)) continue;
        const img = await loadImage(id, src.slice(prefix.length));
        if (img) dataUris.set(src, `data:${img.contentType};base64,${img.bytes.toString('base64')}`);
      }
      return buildSelfContainedHtml(manifest.title, body, (src) => dataUris.get(src) ?? src);
    },
  };
}

/** Shared default store used by the routes / write engine in production. */
export const defaultProjectStore: ProjectStore = createProjectStore();
