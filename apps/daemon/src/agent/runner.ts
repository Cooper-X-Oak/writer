// Agent runner — drives a coding-agent CLI over plain pipes (NOT a PTY; matches open-design).
// Writes the prompt as a stream-json user envelope, keeps stdin OPEN for mid-session injection,
// feeds stdout to the stream parser, and exposes abort with an observable exit code/signal.

import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { RuntimeAgentDef, RuntimeBuildContext } from '@app/agent-defs';
import { createClaudeStreamParser, type ClaudeStreamEvent } from './stream/claude-jsonl.js';
import { userMessageEnvelope } from './envelope.js';

export interface AgentExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  aborted: boolean;
}

export interface AgentRunOptions {
  def: RuntimeAgentDef;
  ctx: RuntimeBuildContext;
  /** Initial user message; sent immediately, stdin then stays open for follow-ups. */
  prompt: string;
  cwd?: string;
  /** Resolved executable path; defaults to def.bin (real resolution is the registry's job). */
  bin?: string;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: typeof nodeSpawn;
  onEvent: (event: ClaudeStreamEvent) => void;
  onExit?: (info: AgentExitInfo) => void;
  onStderr?: (chunk: string) => void;
}

export interface AgentRunHandle {
  readonly pid: number | undefined;
  /** Inject another user message over the still-open stdin (re-edit / comment-to-chat). */
  sendUserMessage(text: string): void;
  /** Close stdin — the CLI finishes the current turn and exits. */
  endInput(): void;
  /** Kill the child; onExit reports aborted=true. */
  abort(signal?: NodeJS.Signals): void;
}

export function startAgentRun(opts: AgentRunOptions): AgentRunHandle {
  const spawnImpl = opts.spawnImpl ?? nodeSpawn;
  const bin = opts.bin ?? opts.def.bin;
  const args = opts.def.buildArgs(opts.ctx);

  // PoC-0: with --include-partial-messages the assistant text arrives twice — streamed deltas AND
  // the final message block. When the def advertises that quirk and partial mode is on, keep the
  // streamed source and drop the duplicate final-message text.
  const dedupePartial =
    opts.ctx.partialMessages === true &&
    opts.def.capabilityFlags?.duplicatesTextWithPartialMessages === true;

  const child: ChildProcess = spawnImpl(bin, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: opts.cwd,
    env: opts.env ?? process.env,
  });

  let aborted = false;

  const parser = createClaudeStreamParser((event) => {
    if (
      dedupePartial &&
      (event.kind === 'text_delta' || event.kind === 'thinking_delta') &&
      event.source === 'message'
    ) {
      return;
    }
    opts.onEvent(event);
  });

  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => parser.feed(chunk));
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => opts.onStderr?.(chunk));

  child.on('close', (code, signal) => {
    parser.flush();
    opts.onExit?.({ code, signal, aborted });
  });

  const writeMessage = (text: string): void => {
    if (child.stdin?.writable) child.stdin.write(userMessageEnvelope(text));
  };

  writeMessage(opts.prompt);

  return {
    get pid() {
      return child.pid;
    },
    sendUserMessage: writeMessage,
    endInput() {
      child.stdin?.end();
    },
    abort(signal) {
      aborted = true;
      child.kill(signal ?? 'SIGTERM');
    },
  };
}
