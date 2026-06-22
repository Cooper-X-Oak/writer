import type { Hotspot } from '@app/contracts';
import { DAEMON_URL } from './base';

function readList(body: unknown): Hotspot[] {
  return (body as { hotspots?: Hotspot[] }).hotspots ?? [];
}

/** Fetch the collected hotspots (empty until the first refresh). */
export async function listHotspots(signal?: AbortSignal): Promise<Hotspot[]> {
  const res = await fetch(`${DAEMON_URL}/api/hotspots`, { signal });
  if (!res.ok) throw new Error(`list hotspots failed: ${res.status}`);
  return readList(await res.json());
}

/** Trigger a collection run and return the fresh list. */
export async function refreshHotspots(signal?: AbortSignal): Promise<Hotspot[]> {
  const res = await fetch(`${DAEMON_URL}/api/hotspots/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal,
  });
  if (!res.ok) throw new Error(`refresh hotspots failed: ${res.status}`);
  return readList(await res.json());
}

/** Hide a hotspot from the list (persists by stable id, survives refreshes). */
export async function dismissHotspot(id: string): Promise<void> {
  const res = await fetch(`${DAEMON_URL}/api/hotspots/${encodeURIComponent(id)}/dismiss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`dismiss hotspot failed: ${res.status}`);
}

/** Un-dismiss a hotspot (restore it to the list on the next read). */
export async function restoreHotspot(id: string): Promise<void> {
  const res = await fetch(`${DAEMON_URL}/api/hotspots/${encodeURIComponent(id)}/dismiss`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`restore hotspot failed: ${res.status}`);
}
