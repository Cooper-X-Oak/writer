// GET /api/projects → { projects: Project[] }   (newest first)
// GET /api/projects/:id/artifact → the rendered article.html (404 if unknown/unsafe id)
// The store is injectable so the routes are unit-tested without touching the filesystem.

import express, { Router } from 'express';
import type { Request, Response } from 'express';
import { createProjectStore, type ProjectStore } from '../workspace/store.js';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

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

  // Insert a new paragraph after the selected block, re-render. (Structural: renumbers blocks; the
  // client must re-sync from the returned HTML and drop its cached blockId.)
  router.post('/projects/:id/block/insert', (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const body = req.body as { blockId?: unknown; text?: unknown };
    const blockId = typeof body.blockId === 'string' ? body.blockId : '';
    const text = typeof body.text === 'string' ? body.text : ''; // empty → store inserts a placeholder
    if (!blockId) {
      res.status(400).json({ error: 'blockId is required' });
      return;
    }
    store
      .insertBlockAfter(id, blockId, text)
      .then((result) => (result ? res.json(result) : res.status(404).json({ error: 'project or block not found' })))
      .catch(() => res.status(500).json({ error: 'failed to insert block' }));
  });

  // Delete a block, re-render. (Structural: renumbers blocks; refuses to empty the article.)
  router.post('/projects/:id/block/delete', (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const body = req.body as { blockId?: unknown };
    const blockId = typeof body.blockId === 'string' ? body.blockId : '';
    if (!blockId) {
      res.status(400).json({ error: 'blockId is required' });
      return;
    }
    store
      .deleteBlock(id, blockId)
      .then((result) => (result ? res.json(result) : res.status(404).json({ error: 'project or block not found' })))
      .catch(() => res.status(500).json({ error: 'failed to delete block' }));
  });

  // Move a block up/down, re-render. (Structural: renumbers blocks.)
  router.post('/projects/:id/block/move', (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const body = req.body as { blockId?: unknown; direction?: unknown };
    const blockId = typeof body.blockId === 'string' ? body.blockId : '';
    const direction = body.direction === 'up' || body.direction === 'down' ? body.direction : '';
    if (!blockId || !direction) {
      res.status(400).json({ error: 'blockId and direction (up|down) are required' });
      return;
    }
    store
      .moveBlock(id, blockId, direction)
      .then((result) => (result ? res.json(result) : res.status(404).json({ error: 'project or block not found' })))
      .catch(() => res.status(500).json({ error: 'failed to move block' }));
  });

  // Rename the project title (manifest + article h1). State-changing → guarded by loopback CORS.
  router.patch('/projects/:id/title', (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const body = req.body as { title?: unknown };
    const title = typeof body.title === 'string' ? body.title : '';
    if (!title.trim()) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    store
      .renameTitle(id, title)
      .then((result) => (result ? res.json(result) : res.status(404).json({ error: 'project not found' })))
      .catch(() => res.status(500).json({ error: 'failed to rename project' }));
  });

  // Add a generated image. Body is the raw image bytes (Content-Type = image/*); alt via ?alt=.
  // Only the Electron main process calls this (it holds the BYOK key and fetched the image).
  router.post(
    '/projects/:id/image',
    express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
    (req: Request, res: Response) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
      const alt = typeof req.query.alt === 'string' ? req.query.alt : undefined;
      const bytes = req.body as Buffer;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        res.status(400).json({ error: 'image body is required' });
        return;
      }
      store
        .addImage(id, { bytes, contentType, alt })
        .then((result) => {
          if (!result) {
            res.status(404).json({ error: 'project not found or unsupported image type' });
            return;
          }
          res.json(result); // { html, name }
        })
        .catch(() => res.status(500).json({ error: 'failed to add image' }));
    },
  );

  // Export a fully self-contained article (images inlined as data URIs) as a downloadable file.
  router.get('/projects/:id/export/html', (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    store
      .exportHtml(id)
      .then((html) => {
        if (html == null) {
          res.status(404).json({ error: 'project not found' });
          return;
        }
        res.type('html').set('Content-Disposition', `attachment; filename="article-${id}.html"`).send(html);
      })
      .catch(() => res.status(500).json({ error: 'failed to export article' }));
  });

  // Serve a project image (referenced as images/<name> in the article; the preview rewrites these
  // relative srcs to absolute URLs).
  router.get('/projects/:id/images/:name', (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const name = typeof req.params.name === 'string' ? req.params.name : '';
    store
      .readImage(id, name)
      .then((img) => {
        if (!img) {
          res.status(404).json({ error: 'image not found' });
          return;
        }
        res.type(img.contentType).send(img.bytes);
      })
      .catch(() => res.status(500).json({ error: 'failed to read image' }));
  });

  return router;
}

export const projectsRouter: Router = createProjectsRouter();
