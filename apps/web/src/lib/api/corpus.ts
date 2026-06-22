import type { MaterialCard, Project } from '@app/contracts';
import { DAEMON_URL } from './base';

const materialsUrl = (projectId: string): string =>
  `${DAEMON_URL}/api/projects/${encodeURIComponent(projectId)}/materials`;

function readCard(body: unknown): MaterialCard {
  return (body as { card: MaterialCard }).card;
}

/** Create a project that starts as a bare material corpus (stage 'corpus'). */
export async function createCorpusProject(title?: string): Promise<Project> {
  const res = await fetch(`${DAEMON_URL}/api/projects/corpus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(title ? { title } : {}),
  });
  if (!res.ok) throw new Error(`create corpus failed: ${res.status}`);
  return (await res.json() as { project: Project }).project;
}

export async function listMaterials(projectId: string, signal?: AbortSignal): Promise<MaterialCard[]> {
  const res = await fetch(materialsUrl(projectId), { signal });
  if (!res.ok) throw new Error(`list materials failed: ${res.status}`);
  return (await res.json() as { cards?: MaterialCard[] }).cards ?? [];
}

async function postMaterial(projectId: string, payload: Record<string, unknown>): Promise<MaterialCard> {
  const res = await fetch(materialsUrl(projectId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`add material failed: ${res.status}`);
  return readCard(await res.json());
}

export const addLinkCard = (projectId: string, input: { url: string; excerpt?: string; title?: string; note?: string }): Promise<MaterialCard> =>
  postMaterial(projectId, { kind: 'link', ...input });

export const addTextCard = (projectId: string, input: { kind: 'text' | 'md'; body: string }): Promise<MaterialCard> =>
  postMaterial(projectId, input);

export const addCodeCard = (projectId: string, input: { snippet: string; language?: string }): Promise<MaterialCard> =>
  postMaterial(projectId, { kind: 'code', ...input });

export async function addImageCard(projectId: string, file: File): Promise<MaterialCard> {
  const res = await fetch(`${materialsUrl(projectId)}/image?alt=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) throw new Error(`add image failed: ${res.status}`);
  return readCard(await res.json());
}

export async function addHotspotCard(projectId: string, hotspotId: string): Promise<MaterialCard> {
  const res = await fetch(`${materialsUrl(projectId)}/from-hotspot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hotspotId }),
  });
  if (!res.ok) throw new Error(`add hotspot failed: ${res.status}`);
  return readCard(await res.json());
}

export async function removeCard(projectId: string, cardId: string): Promise<void> {
  const res = await fetch(`${materialsUrl(projectId)}/${encodeURIComponent(cardId)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`remove material failed: ${res.status}`);
}
