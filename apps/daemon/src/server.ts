// Express 5 app factory. Controllers under /api/* deal in DTOs only (packages/contracts).

import express from 'express';
import type { Express } from 'express';
import cors from 'cors';
import { logger } from './logger.js';
import { healthRouter } from './api/health.js';
import { agentRouter } from './api/agent.js';
import { writeRouter } from './api/write.js';
import { rewriteRouter } from './api/rewrite.js';
import { projectsRouter } from './api/projects.js';
import { hotspotsRouter } from './api/hotspots.js';
import { feedsRouter } from './api/feeds.js';
import { corpusRouter } from './api/corpus.js';

// Local-first: the daemon is loopback-only, but the Electron renderer / Next dev server is a
// *different* origin (e.g. http://localhost:3000) calling http://127.0.0.1:4319 — cross-origin.
// Allow only loopback browser origins; requests with no Origin (curl, Electron main) pass through.
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function createServer(): Express {
  const app = express();
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || LOOPBACK_ORIGIN.test(origin)) cb(null, true);
        else cb(new Error(`origin not allowed: ${origin}`));
      },
    }),
  );
  app.use(express.json());
  app.use((req, _res, next) => {
    logger.debug({ method: req.method, url: req.url }, 'request');
    next();
  });
  app.use('/api', healthRouter);
  app.use('/api', agentRouter);
  app.use('/api', writeRouter);
  app.use('/api', rewriteRouter);
  app.use('/api', projectsRouter);
  app.use('/api', hotspotsRouter);
  app.use('/api', feedsRouter);
  app.use('/api', corpusRouter);
  return app;
}
