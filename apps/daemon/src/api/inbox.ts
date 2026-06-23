// GLOBAL planning-desk inbox (策划台收件箱) — project-INDEPENDENT material staging. Mirrors the
// per-project corpus router (api/corpus.ts) but with NO :id: clip material here before committing to a
// piece, then promote into a project (POST /api/projects/:id/materials/promote, in corpus.ts).
//   GET    /api/inbox                  → { items }
//   POST   /api/inbox {kind,...}       → { item }   (link/text/md/code; SSRF-checked)
//   POST   /api/inbox/image (raw)      → { item }   (Content-Type: image/*, ?alt=)
//   POST   /api/inbox/from-hotspot     → { item }   ({hotspotId} → auto link card)
//   DELETE /api/inbox/:cardId          → 204
//   GET    /api/inbox/images/:name     → image bytes
// Same loopback-CORS + JSON-preflight CSRF guard as every other state-changing route (server.ts).

import express, { Router } from 'express';
import type { Request, Response } from 'express';
import { defaultInboxStore, type InboxStore } from '../inbox/inbox-store.js';
import { defaultHotspotStore, type HotspotStore } from '../collect/store.js';
import { buildManualCard } from './corpus.js';
import { hotspotToCard } from '../corpus/normalize.js';
import { isFetchableUrl } from '../collect/fetch-util.js';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export interface InboxRouterDeps {
  store?: InboxStore;
  hotspotStore?: HotspotStore;
}

export function createInboxRouter(deps: InboxRouterDeps = {}): Router {
  const store = deps.store ?? defaultInboxStore;
  const hotspotStore = deps.hotspotStore ?? defaultHotspotStore;
  const router = Router();

  router.get('/inbox', (_req: Request, res: Response) => {
    store
      .list()
      .then((items) => res.json({ items }))
      .catch(() => res.status(500).json({ error: 'failed to read inbox' }));
  });

  router.post('/inbox', (req: Request, res: Response) => {
    const card = buildManualCard((req.body ?? {}) as Record<string, unknown>);
    if (!card) {
      res.status(400).json({ error: 'a valid material (kind + content; link url must be fetchable) is required' });
      return;
    }
    store
      .addCard(card)
      .then((saved) => {
        if (!saved) {
          res.status(409).json({ error: 'inbox is full' });
          return;
        }
        res.json({ item: saved });
      })
      .catch(() => res.status(500).json({ error: 'failed to add to inbox' }));
  });

  router.post(
    '/inbox/image',
    express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
    (req: Request, res: Response) => {
      const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
      const alt = typeof req.query.alt === 'string' ? req.query.alt : '';
      const bytes = req.body as Buffer;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        res.status(400).json({ error: 'image body is required' });
        return;
      }
      store
        .addImage(bytes, contentType, alt)
        .then((item) => {
          if (!item) {
            res.status(400).json({ error: 'unsupported image type or inbox full' });
            return;
          }
          res.json({ item });
        })
        .catch(() => res.status(500).json({ error: 'failed to add image' }));
    },
  );

  router.post('/inbox/from-hotspot', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { hotspotId?: unknown };
    const hotspotId = typeof body.hotspotId === 'string' ? body.hotspotId : '';
    if (!hotspotId) {
      res.status(400).json({ error: 'hotspotId is required' });
      return;
    }
    hotspotStore
      .read()
      .then((snapshot) => {
        const h = snapshot?.hotspots.find((x) => x.id === hotspotId);
        if (!h) {
          res.status(404).json({ error: 'hotspot not found' });
          return undefined;
        }
        if (!isFetchableUrl(h.url)) {
          res.status(400).json({ error: 'hotspot url is not fetchable' });
          return undefined;
        }
        return store.addCard(hotspotToCard(h)).then((saved) => {
          if (!saved) {
            res.status(409).json({ error: 'inbox is full' });
            return;
          }
          res.json({ item: saved });
        });
      })
      .catch(() => res.status(500).json({ error: 'failed to add hotspot' }));
  });

  router.delete('/inbox/:cardId', (req: Request, res: Response) => {
    const cardId = typeof req.params.cardId === 'string' ? req.params.cardId : '';
    store
      .remove(cardId)
      .then(() => res.status(204).end())
      .catch(() => res.status(500).json({ error: 'failed to remove inbox item' }));
  });

  router.get('/inbox/images/:name', (req: Request, res: Response) => {
    const name = typeof req.params.name === 'string' ? req.params.name : '';
    store
      .readImage(name)
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

export const inboxRouter: Router = createInboxRouter();
