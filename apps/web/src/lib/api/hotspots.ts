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
