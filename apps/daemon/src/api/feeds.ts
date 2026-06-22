// GET    /api/feeds         → { feeds: string[] }   (persisted user RSS feed list)
// POST   /api/feeds {url}    → { feeds }             (add — validates url via isFetchableUrl)
// DELETE /api/feeds {url}    → { feeds }             (remove; url in the JSON body, not a path seg)
// A feed edit takes effect on the next /hotspots/refresh (config is rebuilt per run). Store injected
// so the routes test offline. State-changing routes rely on the loopback-CORS + JSON-preflight CSRF
// guard (server.ts) — never expose a GET mutation trigger.

import { Router } from 'express';
import type { Request, Response } from 'express';
import { defaultFeedsStore, type FeedsStore } from '../collect/feeds-store.js';
import { isFetchableUrl } from '../collect/fetch-util.js';
import { mergeFeeds, MAX_FEEDS } from '../collect/feed-normalize.js';

export interface FeedsRouterDeps {
  store?: FeedsStore;
}

export function createFeedsRouter(deps: FeedsRouterDeps = {}): Router {
  const store = deps.store ?? defaultFeedsStore;
  const router = Router();

  router.get('/feeds', (_req: Request, res: Response) => {
    store
      .read()
      .then((feeds) => res.json({ feeds }))
      .catch(() => res.status(500).json({ error: 'failed to read feeds' }));
  });

  router.post('/feeds', (req: Request, res: Response) => {
    const body = req.body as { url?: unknown };
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url || !isFetchableUrl(url)) {
      res.status(400).json({ error: 'a valid http(s) feed url is required' });
      return;
    }
    store
      .read()
      .then((current) => {
        if (current.includes(url)) return res.json({ feeds: current }); // idempotent re-add
        if (current.length >= MAX_FEEDS) return res.status(400).json({ error: 'feed limit reached' });
        const next = mergeFeeds(current, [url]);
        return store.save(next).then(() => res.json({ feeds: next }));
      })
      .catch(() => res.status(500).json({ error: 'failed to add feed' }));
  });

  router.delete('/feeds', (req: Request, res: Response) => {
    const body = req.body as { url?: unknown };
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    store
      .read()
      .then((current) => {
        const next = current.filter((u) => u !== url);
        return store.save(next).then(() => res.json({ feeds: next }));
      })
      .catch(() => res.status(500).json({ error: 'failed to remove feed' }));
  });

  return router;
}

export const feedsRouter: Router = createFeedsRouter();
