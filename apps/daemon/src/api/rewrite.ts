// POST /api/agent/rewrite — rewrite one article block with an instruction. One-shot (the block is
// short): drives the CLI, collects the full text, returns { text }. The engine is injectable so the
// route is unit-tested without a real CLI; the default engine's deps are injectable too.

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { spawn as nodeSpawn } from 'node:child_process';
import { claudeCode, detectAgent, type DetectResult } from '@app/agent-defs';
import { startAgentRun } from '../agent/runner.js';
import { buildSystemPrompt } from '../agent/prompt.js';
import { buildRewritePrompt } from '../agent/prompts/rewrite.js';
import { writeTempSystemPrompt, type SystemPromptFile } from '../agent/prompts/sysprompt-file.js';
import { buildDiagnosis } from '../agent/diagnose.js';

export interface RewriteInput {
  blockText: string;
  instruction: string;
}

/** Resolves with the rewritten text, or rejects with a user-facing Error. */
export type RewriteEngine = (input: RewriteInput) => Promise<string>;

export interface RewriteEngineDeps {
  detect?: () => Promise<DetectResult>;
  spawnImpl?: typeof nodeSpawn;
  shell?: boolean;
  inactivityMs?: number;
  prepareSystemPrompt?: () => Promise<SystemPromptFile>;
}

const DEFAULT_INACTIVITY_MS = 120_000;
const STDERR_TAIL_MAX = 500;

export function createDefaultRewriteEngine(deps: RewriteEngineDeps = {}): RewriteEngine {
  const detect = deps.detect ?? (() => detectAgent(claudeCode));
  const prepareSystemPrompt = deps.prepareSystemPrompt ?? (() => writeTempSystemPrompt(buildSystemPrompt()));

  return ({ blockText, instruction }) =>
    new Promise<string>((resolve, reject) => {
      let text = '';
      let gotResult = false;
      let stderrTail = '';
      let settled = false;
      let sysPrompt: SystemPromptFile | undefined;

      const fail = (message: string): void => {
        if (settled) return;
        settled = true;
        sysPrompt?.cleanup();
        reject(new Error(message));
      };
      const succeed = (value: string): void => {
        if (settled) return;
        settled = true;
        sysPrompt?.cleanup();
        resolve(value);
      };

      void (async () => {
        const result = await detect();
        if (result.state !== 'READY') {
          fail(buildDiagnosis(claudeCode, result).title);
          return;
        }
        try {
          sysPrompt = await prepareSystemPrompt();
        } catch (err: unknown) {
          fail(`could not prepare writing instructions: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }

        const run = startAgentRun({
          def: claudeCode,
          ctx: { partialMessages: true, systemPromptFile: sysPrompt.path },
          prompt: buildRewritePrompt(blockText, instruction),
          spawnImpl: deps.spawnImpl,
          shell: deps.shell,
          inactivityMs: deps.inactivityMs ?? DEFAULT_INACTIVITY_MS,
          onEvent: (e) => {
            if (e.kind === 'text_delta') text += e.text;
            else if (e.kind === 'error') fail(e.message || 'the agent stream errored');
            else if (e.kind === 'result') {
              gotResult = true;
              if (e.isError) fail('the agent reported an error');
            }
          },
          onStderr: (chunk) => {
            stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_MAX);
          },
          onExit: (info) => {
            if (settled) return;
            if (gotResult && info.code === 0 && text.trim()) {
              succeed(text.trim());
            } else {
              const tail = stderrTail.trim().slice(-200);
              fail(`the agent exited unexpectedly (code ${info.code ?? 'null'})${tail ? `: ${tail}` : ''}`);
            }
          },
        });
        run.endInput();
      })();
    });
}

export const defaultRewriteEngine: RewriteEngine = createDefaultRewriteEngine();

export function createRewriteRouter(engine: RewriteEngine = defaultRewriteEngine): Router {
  const router = Router();
  // CSRF: spends money (spawns the paid CLI). Kept safe by the loopback-only CORS check in
  // server.ts AND the application/json body forcing a preflight — see write.ts for the full note.
  router.post('/agent/rewrite', (req: Request, res: Response) => {
    const body = req.body as { blockText?: unknown; instruction?: unknown };
    const blockText = typeof body.blockText === 'string' ? body.blockText.trim() : '';
    const instruction = typeof body.instruction === 'string' ? body.instruction : '';
    if (!blockText) {
      res.status(400).json({ error: 'blockText is required' });
      return;
    }
    engine({ blockText, instruction })
      .then((text) => res.json({ text }))
      .catch((err: unknown) => res.status(502).json({ error: err instanceof Error ? err.message : 'rewrite failed' }));
  });
  return router;
}

export const rewriteRouter: Router = createRewriteRouter();
