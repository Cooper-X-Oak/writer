// PoC-0 — stream-json parser (seed of apps/daemon/src/agent/stream/claude-jsonl.ts)
//
// Consumes the raw stdout of `claude -p --output-format stream-json` (optionally with
// --include-partial-messages) and normalizes each line into a small, stable event model.
// Designed to be robust to the things that actually break naive parsers:
//   - a JSON object split across two stdout chunks (mid-line),
//   - multiple JSON objects in one chunk,
//   - malformed / non-JSON lines (skip, never throw),
//   - both the "partial messages" delta stream and the "final wrapper only" build.
//
// Normalized event kinds (the contract P1-6 will formalize):
//   status | text_delta | thinking_delta | tool_use | tool_input_delta
//   tool_result | usage | turn_end | result | error | unknown
//
// `unknown` is intentional: the PoC records every unmapped shape so we learn the real
// taxonomy instead of silently dropping it.

export function createClaudeStreamParser(onEvent) {
  let buffer = '';
  const taxonomy = new Map(); // signature -> count, for the findings report

  function note(signature) {
    taxonomy.set(signature, (taxonomy.get(signature) ?? 0) + 1);
  }

  function emit(ev) {
    onEvent(ev);
  }

  function handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      note('malformed-line');
      emit({ kind: 'error', message: 'malformed JSON line', raw: trimmed.slice(0, 200) });
      return;
    }
    route(obj);
  }

  function route(obj) {
    const type = obj?.type ?? '(no-type)';
    switch (type) {
      case 'system':
        note(`system/${obj.subtype ?? '?'}`);
        emit({ kind: 'status', subtype: obj.subtype, sessionId: obj.session_id, raw: obj });
        return;

      case 'assistant': {
        note('assistant');
        const content = obj.message?.content ?? [];
        for (const block of content) {
          if (block.type === 'text') emit({ kind: 'text_delta', text: block.text ?? '' });
          else if (block.type === 'thinking') emit({ kind: 'thinking_delta', text: block.thinking ?? '' });
          else if (block.type === 'tool_use') emit({ kind: 'tool_use', id: block.id, name: block.name, input: block.input });
          else note(`assistant/content/${block.type ?? '?'}`);
        }
        if (obj.message?.stop_reason) emit({ kind: 'turn_end', stopReason: obj.message.stop_reason });
        if (obj.message?.usage) emit({ kind: 'usage', usage: obj.message.usage });
        return;
      }

      case 'user': {
        note('user');
        const content = obj.message?.content ?? [];
        for (const block of content) {
          if (block.type === 'tool_result')
            emit({ kind: 'tool_result', toolUseId: block.tool_use_id, content: block.content });
          else note(`user/content/${block.type ?? '?'}`);
        }
        return;
      }

      case 'stream_event': {
        const ev = obj.event ?? {};
        note(`stream_event/${ev.type ?? '?'}`);
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
          emit({ kind: 'tool_use', id: ev.content_block.id, name: ev.content_block.name, input: ev.content_block.input ?? {} });
        } else if (ev.type === 'content_block_delta') {
          const d = ev.delta ?? {};
          if (d.type === 'text_delta') emit({ kind: 'text_delta', text: d.text ?? '' });
          else if (d.type === 'thinking_delta') emit({ kind: 'thinking_delta', text: d.thinking ?? '' });
          else if (d.type === 'input_json_delta') emit({ kind: 'tool_input_delta', partial: d.partial_json ?? '' });
          else note(`stream_event/content_block_delta/${d.type ?? '?'}`);
        } else if (ev.type === 'message_delta' && ev.delta?.stop_reason) {
          emit({ kind: 'turn_end', stopReason: ev.delta.stop_reason });
          if (ev.usage) emit({ kind: 'usage', usage: ev.usage });
        }
        return;
      }

      case 'rate_limit_event':
        // Real CLI emits these out-of-band; the app should surface budget/quota state from here.
        note('rate_limit_event');
        emit({ kind: 'status', subtype: 'rate_limit', rateLimit: obj.rate_limit_info, sessionId: obj.session_id, raw: obj });
        return;

      case 'result':
        note(`result/${obj.subtype ?? '?'}`);
        emit({
          kind: 'result',
          subtype: obj.subtype,
          sessionId: obj.session_id,
          costUsd: obj.total_cost_usd,
          isError: obj.is_error === true,
          raw: obj,
        });
        return;

      default:
        if (obj?.error) {
          note('error');
          emit({ kind: 'error', message: String(obj.error?.message ?? obj.error), raw: obj });
          return;
        }
        note(`unknown/${type}`);
        emit({ kind: 'unknown', raw: obj });
    }
  }

  return {
    feed(chunk) {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        handleLine(line);
      }
    },
    flush() {
      if (buffer.length) {
        handleLine(buffer);
        buffer = '';
      }
    },
    taxonomy() {
      return Object.fromEntries([...taxonomy.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    },
  };
}
