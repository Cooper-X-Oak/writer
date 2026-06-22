import type { Project } from '@app/contracts';

const DAEMON_URL = process.env.NEXT_PUBLIC_DAEMON_URL ?? 'http://127.0.0.1:4319';

/** Fetch the saved projects, newest first. */
export async function listProjects(signal?: AbortSignal): Promise<Project[]> {
  const res = await fetch(`${DAEMON_URL}/api/projects`, { signal });
  if (!res.ok) throw new Error(`list projects failed: ${res.status}`);
  const body = (await res.json()) as { projects?: Project[] };
  return body.projects ?? [];
}

/** Fetch a project's rendered article HTML. */
export async function getArtifact(id: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${DAEMON_URL}/api/projects/${encodeURIComponent(id)}/artifact`, { signal });
  if (!res.ok) throw new Error(`load artifact failed: ${res.status}`);
  return res.text();
}

/** URL of the self-contained HTML export (images inlined as data URIs). */
export function exportHtmlUrl(id: string): string {
  return `${DAEMON_URL}/api/projects/${encodeURIComponent(id)}/export/html`;
}

/** Fetch the self-contained article as a Blob, ready to download. */
export async function fetchExportHtml(id: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(exportHtmlUrl(id), { signal });
  if (!res.ok) throw new Error(`export failed: ${res.status}`);
  return res.blob();
}

async function postBlockOp(id: string, op: string, payload: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${DAEMON_URL}/api/projects/${encodeURIComponent(id)}/block${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`block ${op || 'patch'} failed: ${res.status}`);
  const body = (await res.json()) as { html?: string };
  return body.html ?? '';
}

/** Replace one block's text (also the manual-edit path); returns the re-rendered article HTML. */
export async function patchBlock(id: string, blockId: string, text: string): Promise<string> {
  return postBlockOp(id, '', { blockId, text });
}

/** Insert a new paragraph after the given block; returns the re-rendered article HTML. */
export async function insertBlockAfter(id: string, blockId: string, text = ''): Promise<string> {
  return postBlockOp(id, '/insert', { blockId, text });
}

/** Delete a block; returns the re-rendered article HTML. */
export async function deleteBlock(id: string, blockId: string): Promise<string> {
  return postBlockOp(id, '/delete', { blockId });
}

/** Move a block up/down; returns the re-rendered article HTML. */
export async function moveBlock(id: string, blockId: string, direction: 'up' | 'down'): Promise<string> {
  return postBlockOp(id, '/move', { blockId, direction });
}

/** Rename the project; returns the re-rendered HTML + the new title. */
export async function renameTitle(id: string, title: string): Promise<{ html: string; title: string }> {
  const res = await fetch(`${DAEMON_URL}/api/projects/${encodeURIComponent(id)}/title`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`rename failed: ${res.status}`);
  return (await res.json()) as { html: string; title: string };
}
