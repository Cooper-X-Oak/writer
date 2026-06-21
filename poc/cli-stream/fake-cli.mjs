#!/usr/bin/env node
// PoC-0 — fake CLI fixture.
//
// Emits a representative `--output-format stream-json --include-partial-messages` sequence so
// the harness + parser can be exercised end-to-end WITHOUT the real CLI or auth. It also reads
// `--input-format stream-json` lines from stdin and produces one "turn" per input message,
// so it doubles as the deterministic fixture for the P1-5 (runner) / P1-6 (parser) tests.
//
// Deliberately stresses the parser: it writes some lines in fragments (split mid-JSON across
// writes) and injects one malformed line.

import { stdin, stdout } from 'node:process';

const write = (obj) => stdout.write(JSON.stringify(obj) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sessionId = 'fake-session-0001';
let turn = 0;

async function emitTurn(userText) {
  turn += 1;
  // assistant text delta, streamed char-ish
  write({ type: 'stream_event', event: { type: 'message_start' } });
  const reply = `echo:${userText}`;
  for (const ch of reply) {
    write({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ch } } });
  }
  // a tool_use turn on the first message only, to exercise tool events + a non-end stop reason
  if (turn === 1) {
    write({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tu_1', name: 'Bash' } } });
    // split an input_json_delta across two writes to test mid-line chunk handling
    stdout.write('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"in');
    await sleep(5);
    stdout.write('put_json_delta","partial_json":"{\\"cmd\\":\\"echo hi\\"}"}}}\n');
    write({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'tool_use' } } });
    write({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'hi' }] } });
    stdout.write('this-is-a-malformed-non-json-line\n'); // parser must skip, not crash
  }
  write({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } } });
  write({ type: 'result', subtype: 'success', session_id: sessionId, total_cost_usd: 0.0001, is_error: false, num_turns: turn });
}

async function main() {
  write({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-haiku', tools: ['Bash'], mcp_servers: [] });

  let buf = '';
  stdin.setEncoding('utf8');
  for await (const chunk of stdin) {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const text = msg?.message?.content?.map((c) => c.text).join('') ?? '';
      await emitTurn(text);
    }
  }
}

main().then(() => process.exit(0));
