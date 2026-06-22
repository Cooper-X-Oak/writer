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

/** Replace one block's text; returns the re-rendered article HTML. */
export async function patchBlock(id: string, blockId: string, text: string): Promise<string> {
  const res = await fetch(`${DAEMON_URL}/api/projects/${encodeURIComponent(id)}/block`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blockId, text }),
  });
  if (!res.ok) throw new Error(`patch block failed: ${res.status}`);
  const body = (await res.json()) as { html?: string };
  return body.html ?? '';
}
