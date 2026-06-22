// Agent runner — drives a coding-agent CLI over plain pipes (NOT a PTY; matches open-design).
// Writes the prompt as a stream-json user envelope, keeps stdin OPEN for mid-session injection,
// feeds stdout to the stream parser, and exposes abort with an observable exit code/signal.

import { spawn as nodeSpawn, execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { buildWinCmdInvocation } from '@app/agent-defs';
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
  /** Spawn through a shell. Required on Windows where coding-agent CLIs are `.cmd`/`.ps1` shims that
   *  Node 22+ refuses to spawn directly (EINVAL, CVE-2024-27980). Defaults to true on win32. */
  shell?: boolean;
  /** Abort the run if no stdout arrives for this many ms (0 = disabled). Reaps a hung CLI so the
   *  response can't stay open and the child process can't leak. */
  inactivityMs?: number;
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

  const isWin = process.platform === 'win32';
  const useShell = opts.shell ?? isWin;

  // On Windows, do NOT rely on shell:true to pass argv — Node concatenates args into one string for
  // cmd.exe with no per-arg quoting, so spaces split tokens and & | < > ( ) inject (CVE-2024-27980
  // class). buildWinCmdInvocation quotes each token AND adds the outer wrap that `cmd /S` strips, so
  // a spaced bin path (C:\Program Files\nodejs\claude.cmd) survives. Spawn cmd.exe verbatim.
  let child: ChildProcess;
  if (useShell && isWin) {
    const inv = buildWinCmdInvocation(bin, args);
    child = spawnImpl(inv.file, inv.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      windowsVerbatimArguments: true,
    });
  } else {
    child = spawnImpl(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: useShell,
    });
  }

  let aborted = false;
  let exited = false;
  let killed = false;
  let idleTimer: NodeJS.Timeout | undefined;

  const clearIdle = (): void => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };

  // A shell-wrapped child is the shell, not the agent; on Windows kill the whole tree so the real
  // CLI (and its node grandchild) don't orphan, falling back to a hard kill if taskkill fails.
  // Only the numeric pid is ever passed to taskkill — never any string/user input.
  const killTree = (signal?: NodeJS.Signals): void => {
    if (killed) return;
    killed = true;
    clearIdle(); // canonical kill path: cancel the watchdog so it can't fire a misleading timeout line
    if (useShell && isWin && typeof child.pid === 'number') {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], (err) => {
        if (err) child.kill('SIGKILL');
      });
    } else {
      child.kill(signal ?? 'SIGTERM');
    }
  };

  const finish = (info: AgentExitInfo): void => {
    if (exited) return;
    exited = true;
    clearIdle();
    opts.onExit?.(info);
  };

  const armIdle = (): void => {
    if (!opts.inactivityMs) return;
    clearIdle();
    idleTimer = setTimeout(() => {
      opts.onStderr?.(`inactivity timeout after ${String(opts.inactivityMs)}ms\n`);
      killTree();
    }, opts.inactivityMs);
  };

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
  child.stdout?.on('data', (chunk: string) => {
    armIdle(); // reset the inactivity window on any output
    parser.feed(chunk);
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => opts.onStderr?.(chunk));

  // Stream-level 'error' (EPIPE / ERR_STREAM_DESTROYED when a write or read races a dying child) is
  // emitted on the stdio streams themselves — NOT on the ChildProcess 'error' channel below. Without
  // these listeners an unhandled 'error' would crash the whole daemon. Surface them as stderr.
  child.stdin?.on('error', (err: Error) => opts.onStderr?.(`stdin error: ${err.message}\n`));
  child.stdout?.on('error', (err: Error) => opts.onStderr?.(`stdout error: ${err.message}\n`));
  child.stderr?.on('error', (err: Error) => opts.onStderr?.(`stderr error: ${err.message}\n`));

  // Spawn failure (bin missing, EINVAL, …) emits 'error'; without a listener Node would throw and
  // crash the daemon. Surface it as a terminal exit instead.
  child.on('error', (err: Error) => {
    opts.onStderr?.(`spawn error: ${err.message}\n`);
    finish({ code: null, signal: null, aborted });
  });

  child.on('close', (code, signal) => {
    parser.flush();
    finish({ code, signal, aborted });
  });

  const writeMessage = (text: string): void => {
    if (child.stdin?.writable) {
      child.stdin.write(userMessageEnvelope(text));
      armIdle(); // any caller-initiated input is fresh activity — reset the inactivity window so a
      // long human pause between mid-session turns can't reap a healthy CLI
    }
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
      killTree(signal);
    },
  };
}
