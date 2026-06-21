import { describe, it, expect } from 'vitest';
import { createClaudeStreamParser, type ClaudeStreamEvent } from './claude-jsonl.js';

/** Feed whole input (optionally in fixed-size chunks) and collect emitted events. */
function run(input: string, chunkSize?: number): { events: ClaudeStreamEvent[]; taxonomy: Record<string, number> } {
  const events: ClaudeStreamEvent[] = [];
  const p = createClaudeStreamParser((e) => events.push(e));
  if (chunkSize) {
    for (let i = 0; i < input.length; i += chunkSize) p.feed(input.slice(i, i + chunkSize));
  } else {
    p.feed(input);
  }
  p.flush();
  return { events, taxonomy: p.taxonomy() };
}

const line = (obj: unknown): string => JSON.stringify(obj) + '\n';

describe('createClaudeStreamParser', () => {
  it('maps system/init to a status event with session id', () => {
    const { events } = run(line({ type: 'system', subtype: 'init', session_id: 's1', tools: [] }));
    expect(events).toEqual([{ kind: 'status', subtype: 'init', sessionId: 's1', raw: expect.anything() }]);
  });

  it('maps assistant blocks: text, thinking, tool_use, plus turn_end and usage', () => {
    const { events } = run(
      line({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'hi' },
            { type: 'thinking', thinking: 'hmm' },
            { type: 'tool_use', id: 't1', name: 'Bash', input: { cmd: 'ls' } },
            { type: 'image', source: {} }, // unknown content type → noted, no event
          ],
          stop_reason: 'end_turn',
          usage: { output_tokens: 3 },
        },
      }),
    );
    expect(events).toEqual([
      { kind: 'text_delta', text: 'hi', source: 'message' },
      { kind: 'thinking_delta', text: 'hmm', source: 'message' },
      { kind: 'tool_use', id: 't1', name: 'Bash', input: { cmd: 'ls' } },
      { kind: 'turn_end', stopReason: 'end_turn' },
      { kind: 'usage', usage: { output_tokens: 3 } },
    ]);
  });

  it('defaults missing assistant text/thinking to empty string', () => {
    const { events } = run(
      line({ type: 'assistant', message: { content: [{ type: 'text' }, { type: 'thinking' }] } }),
    );
    expect(events).toEqual([
      { kind: 'text_delta', text: '', source: 'message' },
      { kind: 'thinking_delta', text: '', source: 'message' },
    ]);
  });

  it('maps user tool_result and notes unknown user content', () => {
    const { events, taxonomy } = run(
      line({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }, { type: 'text', text: 'x' }] },
      }),
    );
    expect(events).toEqual([{ kind: 'tool_result', toolUseId: 't1', content: 'ok' }]);
    expect(taxonomy['user/content/text']).toBe(1);
  });

  it('maps stream_event content_block_start tool_use', () => {
    const { events } = run(
      line({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'u1', name: 'Read' } } }),
    );
    expect(events).toEqual([{ kind: 'tool_use', id: 'u1', name: 'Read', input: {} }]);
  });

  it('maps stream_event content_block_delta variants and notes unknown deltas', () => {
    const input =
      line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } } }) +
      line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'b' } } }) +
      line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"x":1}' } } }) +
      line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'signature_delta', signature: 'z' } } });
    const { events, taxonomy } = run(input);
    expect(events).toEqual([
      { kind: 'text_delta', text: 'a', source: 'stream' },
      { kind: 'thinking_delta', text: 'b', source: 'stream' },
      { kind: 'tool_input_delta', partial: '{"x":1}' },
    ]);
    expect(taxonomy['stream_event/content_block_delta/signature_delta']).toBe(1);
  });

  it('maps stream_event message_delta stop_reason + usage, and notes message_start', () => {
    const input =
      line({ type: 'stream_event', event: { type: 'message_start' } }) +
      line({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } } });
    const { events, taxonomy } = run(input);
    expect(events).toEqual([
      { kind: 'turn_end', stopReason: 'tool_use' },
      { kind: 'usage', usage: { output_tokens: 1 } },
    ]);
    expect(taxonomy['stream_event/message_start']).toBe(1);
  });

  it('maps rate_limit_event to a rate_limit status', () => {
    const info = { status: 'allowed', rateLimitType: 'five_hour' };
    const { events } = run(line({ type: 'rate_limit_event', rate_limit_info: info, session_id: 's1' }));
    expect(events).toEqual([{ kind: 'status', subtype: 'rate_limit', rateLimit: info, sessionId: 's1', raw: expect.anything() }]);
  });

  it('maps result success and result error', () => {
    const ok = run(line({ type: 'result', subtype: 'success', session_id: 's1', total_cost_usd: 0.01, is_error: false }));
    expect(ok.events[0]).toMatchObject({ kind: 'result', subtype: 'success', sessionId: 's1', costUsd: 0.01, isError: false });
    const err = run(line({ type: 'result', subtype: 'error_max_turns', is_error: true }));
    expect(err.events[0]).toMatchObject({ kind: 'result', isError: true });
  });

  it('maps top-level error as both string and object', () => {
    const asString = run(line({ type: 'weird', error: 'boom' }));
    expect(asString.events).toEqual([{ kind: 'error', message: 'boom', raw: expect.anything() }]);
    const asObject = run(line({ type: 'weird', error: { message: 'kaboom' } }));
    expect(asObject.events[0]).toMatchObject({ kind: 'error', message: 'kaboom' });
    const asEmptyObject = run(line({ error: {} }));
    expect(asEmptyObject.events[0]).toMatchObject({ kind: 'error', message: 'error' });
  });

  it('emits unknown for unrecognized types (including missing type)', () => {
    const { events, taxonomy } = run(line({ type: 'brand_new' }) + line({ foo: 1 }));
    expect(events).toEqual([
      { kind: 'unknown', raw: { type: 'brand_new' } },
      { kind: 'unknown', raw: { foo: 1 } },
    ]);
    expect(taxonomy['unknown/brand_new']).toBe(1);
    expect(taxonomy['unknown/(no-type)']).toBe(1);
  });

  it('skips malformed and blank lines without throwing', () => {
    const { events, taxonomy } = run('not json\n\n   \n' + line({ type: 'system', subtype: 'init' }));
    expect(events[0]).toMatchObject({ kind: 'error', message: 'malformed JSON line' });
    expect(events[1]).toMatchObject({ kind: 'status', subtype: 'init' });
    expect(events).toHaveLength(2); // blank lines produced nothing
    expect(taxonomy['malformed-line']).toBe(1);
  });

  it('reassembles a JSON object split across chunks (1-byte feed)', () => {
    const input =
      line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } } }) +
      line({ type: 'result', subtype: 'success', is_error: false });
    const whole = run(input).events;
    const fragmented = run(input, 1).events;
    expect(fragmented).toEqual(whole);
    expect(fragmented[0]).toEqual({ kind: 'text_delta', text: 'hello', source: 'stream' });
  });

  it('handles multiple events in a single chunk and a trailing unterminated line via flush', () => {
    const events: ClaudeStreamEvent[] = [];
    const p = createClaudeStreamParser((e) => events.push(e));
    // two complete lines + one line with no trailing newline
    p.feed(
      line({ type: 'system', subtype: 'init' }) +
        line({ type: 'assistant', message: { content: [{ type: 'text', text: 'a' }] } }) +
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
    );
    expect(events).toHaveLength(2); // result still buffered (no newline)
    p.flush();
    expect(events).toHaveLength(3);
    expect(events[2]).toMatchObject({ kind: 'result', subtype: 'success' });
  });

  it('flush with empty buffer is a no-op', () => {
    const { events } = run(line({ type: 'system', subtype: 'init' }));
    expect(events).toHaveLength(1); // flush already ran in run(); no extra event
  });

  it('passes through tool_use input on content_block_start', () => {
    const { events } = run(
      line({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'x', name: 'Bash', input: { a: 1 } } } }),
    );
    expect(events).toEqual([{ kind: 'tool_use', id: 'x', name: 'Bash', input: { a: 1 } }]);
  });

  it('covers optional/default branches (missing message/event/delta/usage)', () => {
    const input =
      line({ type: 'assistant' }) + // message undefined → content ?? []
      line({ type: 'user' }) + // message undefined → content ?? []
      line({ type: 'stream_event' }) + // event ?? {}
      line({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } }) + // && false → no event
      line({ type: 'stream_event', event: { type: 'content_block_delta' } }) + // delta ?? {} → unknown delta noted
      line({ type: 'stream_event', event: { type: 'message_delta', delta: {} } }) + // no stop_reason → nothing
      line({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' } } }) + // stop but no usage
      line({ type: 'result', is_error: false }); // no subtype/session/cost
    const { events, taxonomy } = run(input);
    expect(events.map((e) => e.kind)).toEqual(['turn_end', 'result']);
    expect(events[0]).toMatchObject({ kind: 'turn_end', stopReason: 'end_turn' });
    expect(events[1]).toMatchObject({ kind: 'result', isError: false });
    expect(taxonomy['stream_event/content_block_start']).toBe(1);
    expect(taxonomy['stream_event/content_block_delta/?']).toBe(1);
  });
});
