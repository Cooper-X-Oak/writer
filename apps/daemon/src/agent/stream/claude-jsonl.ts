// Streaming parser for `claude -p --output-format stream-json` (optionally with
// --include-partial-messages). Normalizes each newline-delimited JSON line into a small, stable
// event model. Ported from the PoC seed (poc/cli-stream/parser.mjs), verified against the real
// CLI 2.1.185 (see docs/agent-layer.md PoC-0).
//
// Robust to what actually breaks naive parsers:
//   - a JSON object split across stdout chunks (mid-line),
//   - multiple JSON objects in one chunk,
//   - malformed / non-JSON lines (skipped, never thrown),
//   - both the partial-message delta stream and the final-wrapper-only build,
//   - out-of-band events (rate_limit_event) and unknown shapes (recorded, not dropped).

export type ClaudeStreamEvent =
  | { kind: 'status'; subtype?: string; sessionId?: string; rateLimit?: unknown; raw: unknown }
  | { kind: 'text_delta'; text: string; source: 'stream' | 'message' }
  | { kind: 'thinking_delta'; text: string; source: 'stream' | 'message' }
  | { kind: 'tool_use'; id?: string; name?: string; input?: unknown }
  | { kind: 'tool_input_delta'; partial: string }
  | { kind: 'tool_result'; toolUseId?: string; content?: unknown }
  | { kind: 'usage'; usage: unknown }
  | { kind: 'turn_end'; stopReason?: string }
  | { kind: 'result'; subtype?: string; sessionId?: string; costUsd?: number; isError: boolean; raw: unknown }
  | { kind: 'error'; message: string; raw?: unknown }
  | { kind: 'unknown'; raw: unknown };

export interface ClaudeStreamParser {
  /** Feed a chunk of stdout. Emits zero or more events for each completed line. */
  feed(chunk: string): void;
  /** Process any trailing buffered line (call once on stream end). */
  flush(): void;
  /** Observed line-shape signatures with counts — for diagnostics / coverage of the taxonomy. */
  taxonomy(): Record<string, number>;
}

// Loose shape of a decoded line. The CLI output is untrusted, so every field is optional.
interface RawBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}
interface RawEvent {
  type?: string;
  content_block?: RawBlock;
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; stop_reason?: string };
  usage?: unknown;
}
interface RawLine {
  type?: string;
  subtype?: string;
  session_id?: string;
  message?: { content?: RawBlock[]; stop_reason?: string; usage?: unknown };
  event?: RawEvent;
  total_cost_usd?: number;
  is_error?: boolean;
  rate_limit_info?: unknown;
  error?: { message?: string } | string;
}

export function createClaudeStreamParser(onEvent: (event: ClaudeStreamEvent) => void): ClaudeStreamParser {
  let buffer = '';
  const taxonomy = new Map<string, number>();

  const note = (signature: string): void => {
    taxonomy.set(signature, (taxonomy.get(signature) ?? 0) + 1);
  };

  function handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let obj: RawLine;
    try {
      obj = JSON.parse(trimmed) as RawLine;
    } catch {
      note('malformed-line');
      onEvent({ kind: 'error', message: 'malformed JSON line', raw: trimmed.slice(0, 200) });
      return;
    }
    route(obj);
  }

  function route(obj: RawLine): void {
    const type = obj.type ?? '(no-type)';
    switch (type) {
      case 'system':
        note(`system/${obj.subtype ?? '?'}`);
        onEvent({ kind: 'status', subtype: obj.subtype, sessionId: obj.session_id, raw: obj });
        return;

      case 'assistant': {
        note('assistant');
        for (const block of obj.message?.content ?? []) {
          if (block.type === 'text') onEvent({ kind: 'text_delta', text: block.text ?? '', source: 'message' });
          else if (block.type === 'thinking') onEvent({ kind: 'thinking_delta', text: block.thinking ?? '', source: 'message' });
          else if (block.type === 'tool_use')
            onEvent({ kind: 'tool_use', id: block.id, name: block.name, input: block.input });
          else note(`assistant/content/${block.type ?? '?'}`);
        }
        if (obj.message?.stop_reason) onEvent({ kind: 'turn_end', stopReason: obj.message.stop_reason });
        if (obj.message?.usage !== undefined) onEvent({ kind: 'usage', usage: obj.message.usage });
        return;
      }

      case 'user': {
        note('user');
        for (const block of obj.message?.content ?? []) {
          if (block.type === 'tool_result')
            onEvent({ kind: 'tool_result', toolUseId: block.tool_use_id, content: block.content });
          else note(`user/content/${block.type ?? '?'}`);
        }
        return;
      }

      case 'stream_event': {
        const ev = obj.event ?? {};
        note(`stream_event/${ev.type ?? '?'}`);
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
          onEvent({ kind: 'tool_use', id: ev.content_block.id, name: ev.content_block.name, input: ev.content_block.input ?? {} });
        } else if (ev.type === 'content_block_delta') {
          const d = ev.delta ?? {};
          if (d.type === 'text_delta') onEvent({ kind: 'text_delta', text: d.text ?? '', source: 'stream' });
          else if (d.type === 'thinking_delta') onEvent({ kind: 'thinking_delta', text: d.thinking ?? '', source: 'stream' });
          else if (d.type === 'input_json_delta') onEvent({ kind: 'tool_input_delta', partial: d.partial_json ?? '' });
          else note(`stream_event/content_block_delta/${d.type ?? '?'}`);
        } else if (ev.type === 'message_delta' && ev.delta?.stop_reason) {
          onEvent({ kind: 'turn_end', stopReason: ev.delta.stop_reason });
          if (ev.usage !== undefined) onEvent({ kind: 'usage', usage: ev.usage });
        }
        return;
      }

      case 'rate_limit_event':
        // Out-of-band; surface so the app can drive budget/quota state (see BudgetLedger).
        note('rate_limit_event');
        onEvent({ kind: 'status', subtype: 'rate_limit', rateLimit: obj.rate_limit_info, sessionId: obj.session_id, raw: obj });
        return;

      case 'result':
        note(`result/${obj.subtype ?? '?'}`);
        onEvent({
          kind: 'result',
          subtype: obj.subtype,
          sessionId: obj.session_id,
          costUsd: obj.total_cost_usd,
          isError: obj.is_error === true,
          raw: obj,
        });
        return;

      default: {
        if (obj.error !== undefined) {
          note('error');
          const message = typeof obj.error === 'string' ? obj.error : (obj.error.message ?? 'error');
          onEvent({ kind: 'error', message, raw: obj });
          return;
        }
        note(`unknown/${type}`);
        onEvent({ kind: 'unknown', raw: obj });
      }
    }
  }

  return {
    feed(chunk: string): void {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        handleLine(line);
      }
    },
    flush(): void {
      if (buffer.length) {
        handleLine(buffer);
        buffer = '';
      }
    },
    taxonomy(): Record<string, number> {
      return Object.fromEntries([...taxonomy.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    },
  };
}
