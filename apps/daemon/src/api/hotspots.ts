// GET  /api/hotspots          → { hotspots: Hotspot[] }   (reads hotspots.json; [] if missing/corrupt)
// POST /api/hotspots/refresh   → { hotspots: Hotspot[] }   (runs a collection, persists, returns it)
// Store + refresh are injectable so the routes test without network/FS. A dead source never 500s a
// refresh — collectHotspots is best-effort and returns whatever resolved.

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { HotspotSnapshot } from '@app/contracts';
import { defaultHotspotStore, type HotspotStore } from '../collect/store.js';
import { defaultRefresh } from '../collect/refresh.js';

export interface HotspotsRouterDeps {
  store?: HotspotStore;
  refresh?: () => Promise<HotspotSnapshot>;
}

export function createHotspotsRouter(deps: HotspotsRouterDeps = {}): Router {
  const store = deps.store ?? defaultHotspotStore;
  const refresh = deps.refresh ?? defaultRefresh;
  const router = Router();
  let inFlight: Promise<HotspotSnapshot> | null = null;

  router.get('/hotspots', (_req: Request, res: Response) => {
    store
      .read()
      .then((snap) => res.json({ hotspots: snap?.hotspots ?? [] }))
      .catch(() => res.status(500).json({ error: 'failed to read hotspots' }));
  });

  // CSRF note: this route reaches out to external HN/RSS network and is state-changing. It is kept
  // safe from drive-by cross-origin POSTs by the loopback-only CORS check (server.ts) AND the
  // application/json preflight. Do NOT relax to a GET trigger or text/plain body.
  router.post('/hotspots/refresh', (_req: Request, res: Response) => {
    // single-flight: concurrent refreshes share one in-progress run instead of stacking re-collects.
    const run = (inFlight ??= refresh().finally(() => {
      inFlight = null;
    }));
    run
      .then((snap) => res.json({ hotspots: snap.hotspots }))
      .catch(() => res.status(500).json({ error: 'failed to refresh hotspots' }));
  });

  return router;
}

export const hotspotsRouter: Router = createHotspotsRouter();
