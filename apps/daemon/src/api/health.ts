// GET /api/health → Health DTO.

import { Router } from 'express';
import type { Health } from '@app/contracts';

const VERSION = process.env.npm_package_version ?? '0.0.0';

export const healthRouter: Router = Router();

healthRouter.get('/health', (_req, res) => {
  const body: Health = {
    status: 'ok',
    version: VERSION,
    uptimeMs: Math.round(process.uptime() * 1000),
  };
  res.json(body);
});
