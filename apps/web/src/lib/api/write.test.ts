import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamWrite } from './write';
import type { WriteStreamEvent } from '@app/contracts';

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('streamWrite', () => {
  it('parses SSE frames, including a frame split across chunks', async () => {
    const events: WriteStreamEvent[] = [];
    const body = sseStream([
      'data: {"type":"status","message":"writing"}\n\ndata: {"type":"delta","te',
      'xt":"你好"}\n\ndata: {"type":"done","costUsd":0.01}\n\n',
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body } as unknown as Response));

    await streamWrite('topic', { onEvent: (e) => events.push(e) });

    expect(events).toEqual([
      { type: 'status', message: 'writing' },
      { type: 'delta', text: '你好' },
      { type: 'done', costUsd: 0.01 },
    ]);
  });

  it('flushes a trailing frame that has no terminating blank line', async () => {
    const events: WriteStreamEvent[] = [];
    const body = sseStream(['data: {"type":"delta","text":"x"}\n\ndata: {"type":"done"}']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body } as unknown as Response));
    await streamWrite('t', { onEvent: (e) => events.push(e) });
    expect(events).toEqual([{ type: 'delta', text: 'x' }, { type: 'done' }]);
  });

  it('skips a malformed frame and keeps parsing the next', async () => {
    const events: WriteStreamEvent[] = [];
    const body = sseStream(['data: {not json}\n\ndata: {"type":"done"}\n\n']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body } as unknown as Response));
    await streamWrite('t', { onEvent: (e) => events.push(e) });
    expect(events).toEqual([{ type: 'done' }]);
  });

  it('throws when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, body: null } as unknown as Response),
    );
    await expect(streamWrite('t', { onEvent: () => undefined })).rejects.toThrow(/write failed: 500/);
  });
});
