// Express 5 app factory. Controllers under /api/* deal in DTOs only (packages/contracts).

import express from 'express';
import type { Express } from 'express';
import { logger } from './logger.js';
import { healthRouter } from './api/health.js';

export function createServer(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    logger.debug({ method: req.method, url: req.url }, 'request');
    next();
  });
  app.use('/api', healthRouter);
  return app;
}
