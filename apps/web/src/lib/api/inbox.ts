// Client for the GLOBAL planning-desk inbox (策划台收件箱) — project-independent material staging.
// Mirrors lib/api/corpus.ts but with no projectId. Consumed by useInbox (A4) / PlanningDesk (A7).

import type { MaterialCard } from '@app/contracts';
import { DAEMON_URL } from './base';

const inboxUrl = `${DAEMON_URL}/api/inbox`;

function readItem(body: unknown): MaterialCard {
  return (body as { item: MaterialCard }).item;
}

export async function listInbox(signal?: AbortSignal): Promise<MaterialCard[]> {
  const res = await fetch(inboxUrl, { signal });
  if (!res.ok) throw new Error(`list inbox failed: ${res.status}`);
  return (await res.json() as { items?: MaterialCard[] }).items ?? [];
}

async function postInbox(payload: Record<string, unknown>): Promise<MaterialCard> {
  const res = await fetch(inboxUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`add to inbox failed: ${res.status}`);
  return readItem(await res.json());
}

export const addInboxLink = (input: { url: string; excerpt?: string; title?: string; note?: string }): Promise<MaterialCard> =>
  postInbox({ kind: 'link', ...input });

export const addInboxText = (input: { kind: 'text' | 'md'; body: string }): Promise<MaterialCard> =>
  postInbox(input);

export const addInboxCode = (input: { snippet: string; language?: string }): Promise<MaterialCard> =>
  postInbox({ kind: 'code', ...input });

export async function addInboxImage(file: File): Promise<MaterialCard> {
  const res = await fetch(`${inboxUrl}/image?alt=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) throw new Error(`add inbox image failed: ${res.status}`);
  return readItem(await res.json());
}

export async function addInboxHotspot(hotspotId: string): Promise<MaterialCard> {
  const res = await fetch(`${inboxUrl}/from-hotspot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hotspotId }),
  });
  if (!res.ok) throw new Error(`add inbox hotspot failed: ${res.status}`);
  return readItem(await res.json());
}

export async function removeInboxItem(cardId: string): Promise<void> {
  const res = await fetch(`${inboxUrl}/${encodeURIComponent(cardId)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`remove inbox item failed: ${res.status}`);
}
