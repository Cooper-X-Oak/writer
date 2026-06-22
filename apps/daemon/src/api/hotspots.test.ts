import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Hotspot, HotspotSnapshot } from '@app/contracts';
import { createHotspotsRouter, type HotspotsRouterDeps } from './hotspots.js';
import type { HotspotStore } from '../collect/store.js';

function serve(deps: HotspotsRouterDeps): Promise<{ url: string; close: () => void }> {
  const app = express();
  app.use(express.json());
  app.use('/api', createHotspotsRouter(deps));
  return new Promise((resolve) => {
    const server: Server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/api`, close: () => server.close() });
    });
  });
}

const HOTSPOT: Hotspot = {
  id: 'hn-abc', sourceType: 'hn', title: 'T', url: 'https://x/1', excerpt: '',
  publishedAt: '2026-06-22T00:00:00.000Z', fetchedAt: '2026-06-22T00:00:00.000Z', score: 0.5,
};
const SNAP: HotspotSnapshot = { collectedAt: '2026-06-22T00:00:00.000Z', hotspots: [HOTSPOT] };

function fakeStore(over: Partial<HotspotStore> = {}): HotspotStore {
  return {
    read: over.read ?? (() => Promise.resolve(SNAP)),
    save: over.save ?? (() => Promise.resolve()),
  };
}

describe('GET /api/hotspots', () => {
  it('returns the persisted hotspots', async () => {
    const { url, close } = await serve({ store: fakeStore() });
    try {
      const res = await fetch(`${url}/hotspots`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ hotspots: [HOTSPOT] });
    } finally {
      close();
    }
  });

  it('returns { hotspots: [] } when the snapshot is missing (store.read → undefined)', async () => {
    const { url, close } = await serve({ store: fakeStore({ read: () => Promise.resolve(undefined) }) });
    try {
      expect(await (await fetch(`${url}/hotspots`)).json()).toEqual({ hotspots: [] });
    } finally {
      close();
    }
  });

  it('returns 500 when the store throws', async () => {
    const { url, close } = await serve({ store: fakeStore({ read: () => Promise.reject(new Error('disk')) }) });
    try {
      expect((await fetch(`${url}/hotspots`)).status).toBe(500);
    } finally {
      close();
    }
  });
});

describe('POST /api/hotspots/refresh', () => {
  it('runs the refresh and returns the fresh list', async () => {
    let refreshed = 0;
    const { url, close } = await serve({ store: fakeStore(), refresh: () => { refreshed += 1; return Promise.resolve(SNAP); } });
    try {
      const res = await fetch(`${url}/hotspots/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ hotspots: [HOTSPOT] });
      expect(refreshed).toBe(1);
    } finally {
      close();
    }
  });

  it('returns 500 when the refresh rejects', async () => {
    const { url, close } = await serve({ store: fakeStore(), refresh: () => Promise.reject(new Error('all sources down')) });
    try {
      const res = await fetch(`${url}/hotspots/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(500);
    } finally {
      close();
    }
  });

  it('does NOT 500 on a partial refresh — returns whatever resolved (empty list is fine)', async () => {
    const partial: HotspotSnapshot = { collectedAt: '2026-06-22T00:00:00.000Z', hotspots: [] };
    const { url, close } = await serve({ store: fakeStore(), refresh: () => Promise.resolve(partial) });
    try {
      const res = await fetch(`${url}/hotspots/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ hotspots: [] });
    } finally {
      close();
    }
  });

  it('releases the single-flight latch after a rejection (a later refresh re-runs, not a stuck 500)', async () => {
    let calls = 0;
    const refresh = (): Promise<HotspotSnapshot> => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('transient')) : Promise.resolve(SNAP);
    };
    const { url, close } = await serve({ store: fakeStore(), refresh });
    try {
      const first = await fetch(`${url}/hotspots/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(first.status).toBe(500); // transient failure
      const second = await fetch(`${url}/hotspots/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(second.status).toBe(200); // latch released → refresh re-invoked, not a cached rejection
      expect(await second.json()).toEqual({ hotspots: [HOTSPOT] });
      expect(calls).toBe(2);
    } finally {
      close();
    }
  });

  it('single-flights concurrent refreshes (one run shared by both requests)', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const refresh = (): Promise<HotspotSnapshot> => {
      calls += 1;
      return gate.then(() => SNAP);
    };
    const { url, close } = await serve({ store: fakeStore(), refresh });
    try {
      const a = fetch(`${url}/hotspots/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const b = fetch(`${url}/hotspots/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await new Promise((r) => setTimeout(r, 30)); // let both requests reach the handler
      release();
      const [ra, rb] = await Promise.all([a, b]);
      expect(ra.status).toBe(200);
      expect(rb.status).toBe(200);
      expect(calls).toBe(1); // refresh invoked once, not twice
    } finally {
      close();
    }
  });
});
