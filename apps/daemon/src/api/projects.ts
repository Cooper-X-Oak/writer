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

  // Patch one block (paragraph) and re-render. Returns the updated article HTML.
  router.post('/projects/:id/block', (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const body = req.body as { blockId?: unknown; text?: unknown };
    const blockId = typeof body.blockId === 'string' ? body.blockId : '';
    const text = typeof body.text === 'string' ? body.text : '';
    if (!blockId || !text.trim()) {
      res.status(400).json({ error: 'blockId and non-empty text are required' });
      return;
    }
    store
      .patchBlock(id, blockId, text)
      .then((result) => {
        if (!result) {
          res.status(404).json({ error: 'project or block not found' });
          return;
        }
        res.json(result); // { html }
      })
      .catch(() => res.status(500).json({ error: 'failed to patch block' }));
  });

  return router;
}

export const projectsRouter: Router = createProjectsRouter();
