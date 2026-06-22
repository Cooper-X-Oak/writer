// GET /api/projects → { projects: Project[] }   (newest first)
// GET /api/projects/:id/artifact → the rendered article.html (404 if unknown/unsafe id)
// The store is injectable so the routes are unit-tested without touching the filesystem.

import { Router } from 'express';
import type { Request, Response } from 'express';
import { createProjectStore, type ProjectStore } from '../workspace/store.js';

export function createProjectsRouter(store: ProjectStore = createProjectStore()): Router {
  const router = Router();

  router.get('/projects', (_req: Request, res: Response) => {
    store
      .list()
      .then((projects) => res.json({ projects }))
      .catch(() => res.status(500).json({ error: 'failed to list projects' }));
  });

  router.get('/projects/:id/artifact', (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    store
      .readArtifact(id)
      .then((html) => {
        if (html == null) {
          res.status(404).json({ error: 'project not found' });
          return;
        }
        res.type('html').send(html);
      })
      .catch(() => res.status(500).json({ error: 'failed to read artifact' }));
  });

  return router;
}

export const projectsRouter: Router = createProjectsRouter();
