// Project store — filesystem-backed (no SQLite; zero native deps for MVP). Writes are atomic
// (temp file + rename) so a crash mid-write never leaves a half-written manifest/artifact. The
// artifact is written first and the manifest LAST, so manifest presence means "fully committed".

import { mkdir, writeFile, rename, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Project } from '@app/contracts';
import {
  projectsRoot,
  projectDir,
  manifestPath,
  artifactPath,
  isSafeProjectId,
  createProjectId,
  ARTIFACT_FILE,
  MANIFEST_FILE,
} from './paths.js';
import { buildManifest, manifestToProject, parseManifest, type ProjectManifest } from './manifest.js';
import { buildArticleHtml } from './render.js';

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

export function createProjectStore(deps: StoreDeps = {}): ProjectStore {
  const root = deps.root ?? projectsRoot();
  const genId = deps.genId ?? (() => createProjectId());
  const now = deps.now ?? (() => new Date());

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

      // artifact first, manifest last (the commit marker).
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
  };
}

/** Shared default store used by the routes / write engine in production. */
export const defaultProjectStore: ProjectStore = createProjectStore();
