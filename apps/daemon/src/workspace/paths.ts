// Workspace path layout. A project = a directory; its files = artifacts; a sidecar manifest.json
// describes it. Directory names are short ids (NOT the topic) to dodge Windows ENAMETOOLONG/illegal
// chars. Pure path helpers + an id generator; the store does the IO.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const MANIFEST_FILE = 'manifest.json';
export const ARTIFACT_FILE = 'article.html';
/** Plain-text draft — the editable source of truth; article.html is rendered from it. */
export const BODY_FILE = 'body.md';
/** Per-project subdirectory holding generated illustration files. */
export const IMAGES_DIR = 'images';
/** Per-project material corpus (资料区) — the dropped/collected material cards. */
export const MATERIALS_FILE = 'materials.json';
/** Per-project subdirectory holding material-card image bytes (sha256-named). */
export const MATERIALS_IMAGES_DIR = 'materials-images';
/** Collected hotspots snapshot — a single file at the data-dir root (sibling of projects/). */
export const HOTSPOTS_FILE = 'hotspots.json';
/** Persisted user RSS feed list — a sidecar at the data-dir root. */
export const FEEDS_FILE = 'feeds.json';
/** Dismissed/hidden hotspot ids — a sidecar at the data-dir root (overlay on hotspots.json). */
export const DISMISSED_FILE = 'dismissed.json';

/** Base data dir for all local state. Override with HOTSPOT_DATA_DIR (Electron passes its userData). */
export function dataDir(): string {
  return process.env.HOTSPOT_DATA_DIR ?? join(homedir(), '.hotspot-writer');
}

export function projectsRoot(base: string = dataDir()): string {
  return join(base, 'projects');
}

/** Path to the collected-hotspots snapshot file (dataDir()/hotspots.json). */
export function hotspotsPath(base: string = dataDir()): string {
  return join(base, HOTSPOTS_FILE);
}

/** Path to the persisted user feed list (dataDir()/feeds.json). */
export function feedsPath(base: string = dataDir()): string {
  return join(base, FEEDS_FILE);
}

/** Path to the dismissed-hotspots sidecar (dataDir()/dismissed.json). */
export function dismissedPath(base: string = dataDir()): string {
  return join(base, DISMISSED_FILE);
}

export function projectDir(root: string, id: string): string {
  return join(root, id);
}

export function manifestPath(dir: string): string {
  return join(dir, MANIFEST_FILE);
}

export function artifactPath(dir: string): string {
  return join(dir, ARTIFACT_FILE);
}

export function bodyPath(dir: string): string {
  return join(dir, BODY_FILE);
}

export function imagesDir(dir: string): string {
  return join(dir, IMAGES_DIR);
}

/** Path to a project's material-corpus sidecar (projectDir/materials.json). */
export function materialsPath(dir: string): string {
  return join(dir, MATERIALS_FILE);
}

/** Path to a project's material-image subdirectory (projectDir/materials-images/). */
export function materialsImagesDir(dir: string): string {
  return join(dir, MATERIALS_IMAGES_DIR);
}

/** An image filename only ever names one path segment under images/. Reject traversal/separators. */
export function isSafeImageName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && name !== '.' && name !== '..';
}

/** Short, time-sortable, collision-resistant id: base36 millis + 8 random hex. Kept short for
 *  Windows path-length headroom. `now` is injectable so the store can be tested deterministically. */
export function createProjectId(now: number = Date.now()): string {
  return `${now.toString(36)}-${randomBytes(4).toString('hex')}`;
}

/** A project id only ever names one path segment. Reject anything that could traverse or escape. */
export function isSafeProjectId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..';
}
