import { DAEMON_URL } from './base';

function readFeeds(body: unknown): string[] {
  return (body as { feeds?: string[] }).feeds ?? [];
}

/** The persisted user RSS feed list. */
export async function listFeeds(signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${DAEMON_URL}/api/feeds`, { signal });
  if (!res.ok) throw new Error(`list feeds failed: ${res.status}`);
  return readFeeds(await res.json());
}

/** Add a feed URL; returns the new full list (daemon validates http/https + non-private). */
export async function addFeed(url: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${DAEMON_URL}/api/feeds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  });
  if (!res.ok) throw new Error(`add feed failed: ${res.status}`);
  return readFeeds(await res.json());
}

/** Remove a feed URL; returns the new list. */
export async function removeFeed(url: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${DAEMON_URL}/api/feeds`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  });
  if (!res.ok) throw new Error(`remove feed failed: ${res.status}`);
  return readFeeds(await res.json());
}
