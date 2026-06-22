const DAEMON_URL = process.env.NEXT_PUBLIC_DAEMON_URL ?? 'http://127.0.0.1:4319';

/** Rewrite one block with an instruction; returns the rewritten text. */
export async function rewrite(blockText: string, instruction: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${DAEMON_URL}/api/agent/rewrite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blockText, instruction }),
    signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `rewrite failed: ${res.status}`);
  }
  const body = (await res.json()) as { text?: string };
  return body.text ?? '';
}
