import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createFeedsRouter } from './feeds.js';
import type { FeedsStore } from '../collect/feeds-store.js';

function serve(store: FeedsStore): Promise<{ url: string; close: () => void }> {
  const app = express();
  app.use(express.json());
  app.use('/api', createFeedsRouter({ store }));
  return new Promise((resolve) => {
    const server: Server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/api`, close: () => server.close() });
    });
  });
}

/** In-memory FeedsStore (no normalization on save — the route + parseFeedList own that). */
function memStore(init: string[] = []): FeedsStore {
  let urls = [...init];
  return { read: () => Promise.resolve([...urls]), save: (u) => { urls = [...u]; return Promise.resolve(); } };
}

const json = (method: string, url: string, body: unknown) =>
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('GET /api/feeds', () => {
  it('returns the persisted feed list', async () => {
    const { url, close } = await serve(memStore(['https://a.com/f']));
    try {
      const res = await fetch(`${url}/feeds`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ feeds: ['https://a.com/f'] });
    } finally { close(); }
  });
  it('returns 500 when the store throws', async () => {
    const { url, close } = await serve({ read: () => Promise.reject(new Error('x')), save: () => Promise.resolve() });
    try {
      expect((await fetch(`${url}/feeds`)).status).toBe(500);
    } finally { close(); }
  });
});

describe('POST /api/feeds', () => {
  it('adds a valid feed and returns the new list; rejects a non-http(s)/private url with 400 (SSRF guard)', async () => {
    const { url, close } = await serve(memStore());
    try {
      const ok = await json('POST', `${url}/feeds`, { url: 'https://news.example.com/rss' });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ feeds: ['https://news.example.com/rss'] });

      expect((await json('POST', `${url}/feeds`, { url: 'http://127.0.0.1/x' })).status).toBe(400);
      expect((await json('POST', `${url}/feeds`, { url: 'javascript:alert(1)' })).status).toBe(400);
      expect((await json('POST', `${url}/feeds`, {})).status).toBe(400);
    } finally { close(); }
  });

  it('is idempotent when re-adding an existing url', async () => {
    const { url, close } = await serve(memStore(['https://a.com/f']));
    try {
      const res = await json('POST', `${url}/feeds`, { url: 'https://a.com/f' });
      expect(await res.json()).toEqual({ feeds: ['https://a.com/f'] });
    } finally { close(); }
  });

  it('rejects a new url with 400 when the list is at the cap', async () => {
    const full = Array.from({ length: 16 }, (_, i) => `https://e${String(i)}.com/f`);
    const { url, close } = await serve(memStore(full));
    try {
      const res = await json('POST', `${url}/feeds`, { url: 'https://new.com/f' });
      expect(res.status).toBe(400);
      expect((await res.json() as { error: string }).error).toMatch(/limit/);
    } finally { close(); }
  });
});

describe('DELETE /api/feeds', () => {
  it('removes a feed (idempotent for an absent one) and 400s without a url', async () => {
    const { url, close } = await serve(memStore(['https://a.com/f', 'https://b.com/f']));
    try {
      const res = await json('DELETE', `${url}/feeds`, { url: 'https://a.com/f' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ feeds: ['https://b.com/f'] });

      const absent = await json('DELETE', `${url}/feeds`, { url: 'https://gone.com/f' });
      expect(await absent.json()).toEqual({ feeds: ['https://b.com/f'] }); // idempotent

      expect((await json('DELETE', `${url}/feeds`, {})).status).toBe(400);
    } finally { close(); }
  });
});
