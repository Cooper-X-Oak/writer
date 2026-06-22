// 资料区 (material corpus) — per-project material cards. All routes nest under a project id.
//   POST   /api/projects/corpus                       → { project }   (create a corpus-stage project)
//   GET    /api/projects/:id/materials                → { cards }
//   POST   /api/projects/:id/materials {kind,...}      → { card }      (link/text/md/code; SSRF-checked)
//   POST   /api/projects/:id/materials/image (raw)     → { card }      (Content-Type: image/*, ?alt=)
//   POST   /api/projects/:id/materials/from-hotspot    → { card }      ({hotspotId} → auto link card)
//   DELETE /api/projects/:id/materials/:cardId         → 204
//   GET    /api/projects/:id/materials/images/:name    → image bytes
// Stores injected so routes test offline. State-changing routes rely on the loopback-CORS +
// JSON-preflight CSRF guard (server.ts) — no GET mutation trigger.

import express, { Router } from 'express';
import type { Request, Response } from 'express';
import type { MaterialCard } from '@app/contracts';
import { defaultMaterialsStore, type MaterialsStore } from '../corpus/materials-store.js';
import { createProjectStore, type ProjectStore } from '../workspace/store.js';
import { defaultHotspotStore, type HotspotStore } from '../collect/store.js';
import { linkCard, textCard, mdCard, codeCard, hotspotToCard } from '../corpus/normalize.js';
import { isFetchableUrl } from '../collect/fetch-util.js';
import {
  runInquiry,
  seedFromHotspot,
  seedFromCard,
  seedFromQuery,
  existingFromCards,
  type AgentClassifier,
  type Seed,
} from '../collect/inquiry.js';
import { defaultAgentClassifier } from '../collect/inquiry-agent.js';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export interface CorpusRouterDeps {
  store?: MaterialsStore;
  projectStore?: ProjectStore;
  hotspotStore?: HotspotStore;
  /** Tier-B 询证 classifier; only invoked when the request opts in (useAgent). */
  classifier?: AgentClassifier;
}

/** Build a card from a manual JSON drop. Returns undefined for an unknown kind, empty content, or an
 *  unfetchable link url (linkCard re-runs the SSRF guard). */
function buildManualCard(body: Record<string, unknown>): MaterialCard | undefined {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  switch (body.kind) {
    case 'link': {
      const url = str(body.url).trim();
      if (!url) return undefined;
      return linkCard({ url, excerpt: str(body.excerpt) || undefined, title: str(body.title) || undefined, note: str(body.note) || undefined });
    }
    case 'text': return str(body.body) ? textCard(str(body.body)) : undefined;
    case 'md': return str(body.body) ? mdCard(str(body.body)) : undefined;
    case 'code': return str(body.snippet) ? codeCard({ snippet: str(body.snippet), language: str(body.language) || undefined }) : undefined;
    default: return undefined;
  }
}

export function createCorpusRouter(deps: CorpusRouterDeps = {}): Router {
  const store = deps.store ?? defaultMaterialsStore;
  const projectStore = deps.projectStore ?? createProjectStore();
  const hotspotStore = deps.hotspotStore ?? defaultHotspotStore;
  const classifier = deps.classifier ?? defaultAgentClassifier;
  const router = Router();

  router.post('/projects/corpus', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { title?: unknown };
    const title = typeof body.title === 'string' ? body.title : undefined;
    projectStore
      .createCorpus({ title })
      .then((project) => res.json({ project }))
      .catch(() => res.status(500).json({ error: 'failed to create corpus' }));
  });

  router.get('/projects/:id/materials', (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    store
      .list(id)
      .then((cards) => res.json({ cards }))
      .catch(() => res.status(500).json({ error: 'failed to read materials' }));
  });

  router.post('/projects/:id/materials', (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const card = buildManualCard((req.body ?? {}) as Record<string, unknown>);
    if (!card) {
      res.status(400).json({ error: 'a valid material (kind + content; link url must be fetchable) is required' });
      return;
    }
    store
      .addCard(id, card)
      .then((saved) => {
        if (!saved) {
          res.status(404).json({ error: 'project not found or corpus full' });
          return;
        }
        res.json({ card: saved });
      })
      .catch(() => res.status(500).json({ error: 'failed to add material' }));
  });

  router.post(
    '/projects/:id/materials/image',
    express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
    (req: Request, res: Response) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
      const alt = typeof req.query.alt === 'string' ? req.query.alt : '';
      const bytes = req.body as Buffer;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        res.status(400).json({ error: 'image body is required' });
        return;
      }
      store
        .addImage(id, bytes, contentType, alt)
        .then((card) => {
          if (!card) {
            res.status(404).json({ error: 'project not found or unsupported image type' });
            return;
          }
          res.json({ card });
        })
        .catch(() => res.status(500).json({ error: 'failed to add image' }));
    },
  );

  router.post('/projects/:id/materials/from-hotspot', (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
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
        return store.addCard(id, hotspotToCard(h)).then((saved) => {
          if (!saved) {
            res.status(404).json({ error: 'project not found or corpus full' });
            return;
          }
          res.json({ card: saved });
        });
      })
      .catch(() => res.status(500).json({ error: 'failed to add hotspot' }));
  });

  // W2 询证: gather 补充/对比 evidence for a seed (an existing 原始 card, a hotspot, or a free query)
  // from the already-collected hotspot snapshot, classify (rule, or rule+agent when useAgent), and
  // persist the new auto cards. CSRF: same loopback-CORS + JSON-preflight guard as the other POSTs.
  router.post('/projects/:id/inquiry', (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const body = (req.body ?? {}) as { hotspotId?: unknown; seedCardId?: unknown; query?: unknown; useAgent?: unknown };
    const useAgent = body.useAgent === true;

    void (async () => {
      try {
        const [existingCards, snapshot] = await Promise.all([store.list(id), hotspotStore.read()]);
        const hotspots = snapshot?.hotspots ?? [];

        let seed: Seed | undefined;
        if (typeof body.seedCardId === 'string' && body.seedCardId) {
          const card = existingCards.find((c) => c.id === body.seedCardId);
          seed = card ? seedFromCard(card) : undefined;
        } else if (typeof body.hotspotId === 'string' && body.hotspotId) {
          const h = hotspots.find((x) => x.id === body.hotspotId);
          seed = h ? seedFromHotspot(h) : undefined;
        } else if (typeof body.query === 'string') {
          seed = seedFromQuery(body.query);
        }
        if (!seed) {
          res.status(400).json({ error: 'a valid seed (seedCardId | hotspotId | query) is required' });
          return;
        }

        const result = await runInquiry({
          seed,
          hotspots,
          existing: existingFromCards(existingCards),
          classifier: useAgent ? classifier : undefined,
        });

        const added: MaterialCard[] = [];
        const skipped: { url: string; reason: string }[] = [];
        for (const card of result.cards) {
          const saved = await store.addCard(id, card);
          if (saved) added.push(saved);
          else skipped.push({ url: card.content.url, reason: 'project not found or corpus full' });
        }
        // Candidates existed but none could persist → the project is missing or the corpus is full.
        if (result.cards.length > 0 && added.length === 0) {
          res.status(404).json({ error: 'project not found or corpus full' });
          return;
        }
        res.json({ added, skipped, usedAgent: result.usedAgent });
      } catch {
        res.status(500).json({ error: 'failed to run inquiry' });
      }
    })();
  });

  router.delete('/projects/:id/materials/:cardId', (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const cardId = typeof req.params.cardId === 'string' ? req.params.cardId : '';
    store
      .remove(id, cardId)
      .then((result) => {
        if (!result) {
          res.status(404).json({ error: 'project not found' });
          return;
        }
        res.status(204).end();
      })
      .catch(() => res.status(500).json({ error: 'failed to remove material' }));
  });

  router.get('/projects/:id/materials/images/:name', (req: Request, res: Response) => {
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

export const corpusRouter: Router = createCorpusRouter();
