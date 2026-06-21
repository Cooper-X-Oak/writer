#!/usr/bin/env node
// PoC-0 — delegate-CLI stream-contract spike harness.
//
// Verifies the three unknowns from docs/agent-layer.md (PoC-0):
//   1. the stdin user-message envelope shape for `--input-format stream-json`,
//   2. that stdin can stay OPEN across a turn so a follow-up user message is accepted
//      mid-session (the basis for re-edit / comment-to-chat),
//   3. that the parser handles every output line type the CLI actually emits.
//
// Usage:
//   node run.mjs --fake            # deterministic, no real CLI / no auth
//   node run.mjs --real [--model haiku]
//
// It spawns the CLI, writes message #1, waits for the first `result`, then writes message #2
// over the SAME still-open stdin, waits for the second `result`, then closes stdin. Everything
// observed is normalized and dumped to findings.<mode>.json + a raw line log.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClaudeStreamParser } from './parser.mjs';
import { userMessage } from './envelope.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mode = args.includes('--real') ? 'real' : 'fake';
const model = (() => { const i = args.indexOf('--model'); return i !== -1 ? args[i + 1] : 'haiku'; })();
// NOTE: bypassPermissions maps to --dangerously-skip-permissions, which the CLI refuses under
// root/sudo. The trivial prompts here need no tools, so `default` is sufficient for the spike.
const permissionMode = (() => { const i = args.indexOf('--permission-mode'); return i !== -1 ? args[i + 1] : 'default'; })();
const HARD_TIMEOUT_MS = 120_000;

const MSG1 = 'Reply with exactly this token and nothing else: PING1';
const MSG2 = 'Reply with exactly this token and nothing else: PING2';

function buildSpawn() {
  if (mode === 'fake') {
    return { cmd: process.execPath, argv: [join(here, 'fake-cli.mjs')] };
  }
  return {
    cmd: 'claude',
    argv: [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode', permissionMode,
      '--model', model,
    ],
  };
}

function main() {
  const { cmd, argv } = buildSpawn();
  const rawLines = [];
  const events = [];
  const kindCounts = {};
  const sessionIds = new Set();
  let resultCount = 0;
  let textAfterMsg2 = '';
  let sawMsg2Sent = false;

  const parser = createClaudeStreamParser((ev) => {
    events.push(ev);
    kindCounts[ev.kind] = (kindCounts[ev.kind] ?? 0) + 1;
    if (ev.sessionId) sessionIds.add(ev.sessionId);
    if (ev.kind === 'text_delta' && sawMsg2Sent) textAfterMsg2 += ev.text;
    if (ev.kind === 'result') {
      resultCount += 1;
      if (resultCount === 1) {
        // message #1's turn finished — inject the follow-up over the still-open stdin.
        sawMsg2Sent = true;
        child.stdin.write(userMessage(MSG2));
      } else if (resultCount >= 2) {
        child.stdin.end(); // both turns done; let the process exit
      }
    }
  });

  console.log(`[poc] mode=${mode} spawning: ${cmd} ${argv.join(' ')}`);
  const child = spawn(cmd, argv, { stdio: ['pipe', 'pipe', 'pipe'] });

  const killTimer = setTimeout(() => {
    console.error('[poc] HARD TIMEOUT — killing child');
    child.kill('SIGKILL');
  }, HARD_TIMEOUT_MS);

  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { rawLines.push(chunk); parser.feed(chunk); });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  child.on('error', (err) => {
    clearTimeout(killTimer);
    finish({ spawnError: String(err) , exitCode: null, signal: null });
  });

  child.on('close', (code, signal) => {
    clearTimeout(killTimer);
    parser.flush();
    finish({ exitCode: code, signal, stderr: stderr.slice(0, 4000) });
  });

  // kick off: send message #1
  child.stdin.write(userMessage(MSG1));

  function finish(meta) {
    const findings = {
      mode,
      argv: [cmd, ...argv],
      envelopeSent: { msg1: userMessage(MSG1).trim(), msg2: userMessage(MSG2).trim() },
      answers: {
        q1_envelope_accepted: resultCount >= 1, // CLI produced a turn from our envelope
        q2_midsession_injection_worked: resultCount >= 2 && /PING2/i.test(textAfterMsg2),
        q3_taxonomy_fully_mapped: !(kindCounts.unknown > 0),
      },
      sessionContinuity: { distinctSessionIds: [...sessionIds], stableAcrossTurns: sessionIds.size <= 1 },
      resultCount,
      textAfterMsg2: textAfterMsg2.slice(0, 200),
      kindCounts,
      observedTaxonomy: parser.taxonomy(),
      eventSample: events.slice(0, 12),
      ...meta,
    };
    const out = join(here, `findings.${mode}.json`);
    writeFileSync(out, JSON.stringify(findings, null, 2));
    writeFileSync(join(here, `raw.${mode}.log`), rawLines.join(''));
    console.log(`[poc] wrote ${out}`);
    console.log('[poc] answers:', JSON.stringify(findings.answers));
    console.log('[poc] taxonomy:', JSON.stringify(findings.observedTaxonomy));
    console.log('[poc] kindCounts:', JSON.stringify(kindCounts));
    if (meta.spawnError) console.error('[poc] spawnError:', meta.spawnError);
    if (meta.stderr) console.error('[poc] stderr (head):', meta.stderr.slice(0, 600));
    process.exit(0);
  }
}

main();
