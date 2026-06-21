import type { Health } from '@app/contracts';

// Daemon base URL. NEXT_PUBLIC_ so it is inlined into the browser bundle; defaults to the
// loopback daemon. The call is cross-origin (web origin → 127.0.0.1:4319) — the daemon allows
// loopback origins via CORS (see apps/daemon/src/server.ts).
const DAEMON_URL = process.env.NEXT_PUBLIC_DAEMON_URL ?? 'http://127.0.0.1:4319';

export async function getHealth(): Promise<Health> {
  const res = await fetch(`${DAEMON_URL}/api/health`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`health request failed: ${res.status}`);
  return (await res.json()) as Health;
}
