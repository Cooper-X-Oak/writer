// Poll an HTTP health endpoint until the daemon reports { status: 'ok' }, or time out.
// Platform-neutral and unit-tested; fetch is injectable for tests.

export interface WaitForHealthOptions {
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
}

export async function waitForHealth(url: string, opts: WaitForHealthOptions = {}): Promise<void> {
  const { timeoutMs = 15_000, intervalMs = 200, fetchImpl = fetch } = opts;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetchImpl(url);
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body.status === 'ok') return;
      }
    } catch {
      // daemon not accepting connections yet — keep polling
    }
    if (Date.now() >= deadline) {
      throw new Error(`daemon health not ready within ${timeoutMs}ms: ${url}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
