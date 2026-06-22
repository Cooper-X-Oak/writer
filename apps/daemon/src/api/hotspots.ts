// GET  /api/hotspots          → { hotspots: Hotspot[] }   (reads hotspots.json; [] if missing/corrupt)
// POST /api/hotspots/refresh   → { hotspots: Hotspot[] }   (runs a collection, persists, returns it)
// Store + refresh are injectable so the routes test without network/FS. A dead source never 500s a
// refresh — collectHotspots is best-effort and returns whatever resolved.

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { HotspotSnapshot } from '@app/contracts';
import { defaultHotspotStore, type HotspotStore } from '../collect/store.js';
import { defaultDismissedStore, type DismissedStore } from '../collect/dismissed-store.js';
import { defaultRefresh } from '../collect/refresh.js';

export interface HotspotsRouterDeps {
  store?: HotspotStore;
  refresh?: () => Promise<HotspotSnapshot>;
  dismissed?: DismissedStore;
}

export function createHotspotsRouter(deps: HotspotsRouterDeps = {}): Router {
  const store = deps.store ?? defaultHotspotStore;
  const refresh = deps.refresh ?? defaultRefresh;
  const dismissed = deps.dismissed ?? defaultDismissedStore;
  const router = Router();
  let inFlight: Promise<HotspotSnapshot> | null = null;

  // The dismissed set is an overlay applied at READ time — the snapshot stays the pure collector
  // output (a refresh overwrites hotspots.json wholesale; dismissals live in their own sidecar).
  router.get('/hotspots', (_req: Request, res: Response) => {
    Promise.all([store.read(), dismissed.read()])
      .then(([snap, dropped]) =>
        res.json({ hotspots: (snap?.hotspots ?? []).filter((h) => !dropped.has(h.id)) }),
      )
      .catch(() => res.status(500).json({ error: 'failed to read hotspots' }));
  });

  // Hide a hotspot from the list (persists by stable id, survives refreshes). POST = dismiss,
  // DELETE = restore. id keys JSON (not a path segment), so no path-safety guard is needed.
  router.post('/hotspots/:id/dismiss', (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    dismissed
      .dismiss(id)
      .then(() => res.status(204).end())
      .catch(() => res.status(500).json({ error: 'failed to dismiss hotspot' }));
  });
  router.delete('/hotspots/:id/dismiss', (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    dismissed
      .restore(id)
      .then(() => res.status(204).end())
      .catch(() => res.status(500).json({ error: 'failed to restore hotspot' }));
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
