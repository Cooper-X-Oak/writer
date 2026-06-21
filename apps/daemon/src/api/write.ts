// POST /api/agent/write — drive the local coding-agent CLI to draft an article from a topic,
// streamed back as Server-Sent Events. The write engine is injectable so the route is unit-tested
// without spawning a real CLI; the default engine's deps (detect, spawn) are injectable too so its
// exit/error mapping is testable without a real process.

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { spawn as nodeSpawn } from 'node:child_process';
import { claudeCode, detectAgent, type DetectResult } from '@app/agent-defs';
import type { WriteStreamEvent } from '@app/contracts';
import { startAgentRun, type AgentRunHandle } from '../agent/runner.js';
import { buildWritePrompt } from '../agent/prompt.js';
import { buildDiagnosis } from '../agent/diagnose.js';
import { defaultProjectStore } from '../workspace/store.js';

export interface WriteCallbacks {
  onStatus: (message: string) => void;
  onDelta: (text: string) => void;
  /** projectId is the persisted draft's id, omitted if nothing was saved. */
  onDone: (costUsd?: number, projectId?: string) => void;
  onError: (message: string) => void;
}

export interface WriteHandle {
  abort: () => void;
}

/** Starts a write run and reports progress via callbacks; returns an abort handle. */
export type WriteEngine = (topic: string, cb: WriteCallbacks) => WriteHandle;

export interface EngineDeps {
  detect?: () => Promise<DetectResult>;
  spawnImpl?: typeof nodeSpawn;
  shell?: boolean;
  inactivityMs?: number;
  /** Persist the finished draft; defaults to the shared filesystem store. Injectable for tests. */
  persist?: (input: { topic: string; body: string }) => Promise<{ id: string }>;
}

const STDERR_TAIL_MAX = 500;
const DEFAULT_INACTIVITY_MS = 120_000;

// Default engine: gate on agent readiness, spawn the real CLI, and map its stream + terminal exit
// to callbacks. Terminal status is decided from the AgentExitInfo and observed events — a spawn
// failure or abnormal exit becomes onError, NOT a silent onDone.
export function createDefaultEngine(deps: EngineDeps = {}): WriteEngine {
  const detect = deps.detect ?? (() => detectAgent(claudeCode));
  const persist = deps.persist ?? ((input) => defaultProjectStore.create(input));
  return (topic, cb) => {
    let aborted = false;
    let errored = false;
    let gotResult = false;
    let costUsd: number | undefined;
    let stderrTail = '';
    let draft = '';
    let run: AgentRunHandle | undefined;

    const fail = (message: string): void => {
      if (errored) return;
      errored = true;
      cb.onError(message);
    };

    // Persist the streamed draft, then report done. A save failure is non-fatal — the user already
    // saw the draft — so surface it as a status note and still finish (never silently swallow it).
    const finishOk = (): void => {
      if (!draft.trim()) {
        cb.onDone(costUsd);
        return;
      }
      persist({ topic, body: draft })
        .then((project) => cb.onDone(costUsd, project.id))
        .catch((err: unknown) => {
          cb.onStatus(`draft not saved: ${err instanceof Error ? err.message : String(err)}`);
          cb.onDone(costUsd);
        });
    };

    void (async () => {
      cb.onStatus('checking agent');
      const result = await detect();
      if (aborted) return;
      if (result.state !== 'READY') {
        fail(buildDiagnosis(claudeCode, result).title);
        return;
      }

      cb.onStatus('writing');
      run = startAgentRun({
        def: claudeCode,
        ctx: { partialMessages: true },
        prompt: buildWritePrompt(topic),
        spawnImpl: deps.spawnImpl,
        shell: deps.shell,
        inactivityMs: deps.inactivityMs ?? DEFAULT_INACTIVITY_MS,
        onEvent: (e) => {
          if (e.kind === 'text_delta') {
            draft += e.text;
            cb.onDelta(e.text);
          } else if (e.kind === 'error') fail(e.message || 'the agent stream errored');
          else if (e.kind === 'result') {
            gotResult = true;
            costUsd = e.costUsd;
            if (e.isError) fail('the agent reported an error');
          }
        },
        onStderr: (chunk) => {
          stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_MAX);
        },
        onExit: (info) => {
          if (errored || aborted || info.aborted) return;
          if (gotResult && info.code === 0) {
            finishOk();
          } else {
            const tail = stderrTail.trim().slice(-200);
            cb.onError(`the agent exited unexpectedly (code ${info.code ?? 'null'})${tail ? `: ${tail}` : ''}`);
          }
        },
      });
      run.endInput(); // single-shot: close stdin so the CLI finishes this one turn and exits
    })();

    return {
      abort() {
        aborted = true;
        run?.abort();
      },
    };
  };
}

export const defaultWriteEngine: WriteEngine = createDefaultEngine();

export function createWriteRouter(engine: WriteEngine = defaultWriteEngine): Router {
  const router = Router();
  // CSRF note: this route spends money (spawns the paid CLI). It is kept safe from drive-by
  // cross-origin POSTs by two things working together — the loopback-only CORS check in server.ts
  // AND the application/json body (a non-simple content-type that forces a CORS preflight). Do NOT
  // relax to text/plain or add a GET trigger without an explicit anti-CSRF token.
  router.post('/agent/write', (req: Request, res: Response) => {
    const body = req.body as { topic?: unknown };
    const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
    if (!topic) {
      res.status(400).json({ error: 'topic is required' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    let ended = false;
    const send = (ev: WriteStreamEvent): void => {
      if (ended) return;
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    };
    const end = (): void => {
      if (ended) return;
      ended = true;
      res.end();
    };

    const handle = engine(topic, {
      onStatus: (message) => send({ type: 'status', message }),
      onDelta: (text) => send({ type: 'delta', text }),
      onDone: (cost, projectId) => {
        send({ type: 'done', costUsd: cost, projectId });
        end();
      },
      onError: (message) => {
        send({ type: 'error', message });
        end();
      },
    });

    // Detect a real client disconnect via the RESPONSE stream. NOTE: req.on('close') is wrong here —
    // it fires as soon as express.json() finishes reading the request body, not when the client
    // leaves, which would abort every run mid-flight. res 'close' fires on actual socket close; the
    // `ended` guard distinguishes a normal finish from the client navigating away.
    res.on('close', () => {
      if (!ended) {
        handle.abort();
        ended = true;
      }
    });
  });
  return router;
}

export const writeRouter = createWriteRouter();
