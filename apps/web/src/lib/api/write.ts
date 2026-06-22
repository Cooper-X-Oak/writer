import type { WriteStreamEvent } from '@app/contracts';

const DAEMON_URL = process.env.NEXT_PUBLIC_DAEMON_URL ?? 'http://127.0.0.1:4319';

export interface WriteHandlers {
  onEvent: (event: WriteStreamEvent) => void;
}

/** POST a topic and consume the SSE stream of write events. Resolves when the stream ends.
 *  Pass an AbortSignal to cancel (aborts the daemon-side run via the closed connection). */
export async function streamWrite(
  topic: string,
  handlers: WriteHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${DAEMON_URL}/api/agent/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`write failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const emitFrame = (frame: string): void => {
    const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
    if (!dataLine) return;
    try {
      handlers.onEvent(JSON.parse(dataLine.slice(5).trim()) as WriteStreamEvent);
    } catch {
      // ignore malformed frame
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; each frame's payload is its `data:` field.
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      emitFrame(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
  }

  // Flush a trailing frame the server didn't terminate with a blank line (don't depend on the
  // daemon always appending one).
  if (buffer.trim()) emitFrame(buffer);
}
