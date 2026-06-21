// GET /api/agent/detect → AgentDiagnosis for the user's coding-agent CLI (first-run guide).
// The detector is injectable so the route is unit-tested without spawning a real CLI.

import { Router } from 'express';
import { claudeCode, detectAgent, type RuntimeAgentDef, type DetectResult } from '@app/agent-defs';
import { buildDiagnosis } from '../agent/diagnose.js';

export function createAgentRouter(
  detect: () => Promise<DetectResult> = () => detectAgent(claudeCode),
  def: RuntimeAgentDef = claudeCode,
): Router {
  const router = Router();
  router.get('/agent/detect', (_req, res) => {
    void (async () => {
      const result = await detect();
      res.json(buildDiagnosis(def, result));
    })();
  });
  return router;
}

export const agentRouter = createAgentRouter();
