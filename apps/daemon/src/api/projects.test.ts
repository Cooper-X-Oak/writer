import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Project } from '@app/contracts';
import { createProjectsRouter } from './projects.js';
import type { ProjectStore } from '../workspace/store.js';

function serve(store: ProjectStore): Promise<{ url: string; close: () => void }> {
  const app = express();
  app.use(express.json());
  app.use('/api', createProjectsRouter(store));
  return new Promise((resolve) => {
    const server: Server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/api`, close: () => server.close() });
    });
  });
}

const PROJECT: Project = { id: 'p1', dir: '/p/p1', title: '标题', createdAt: '2026-06-22T00:00:00.000Z' };

function fakeStore(over: Partial<ProjectStore> = {}): ProjectStore {
  return {
    create: over.create ?? (() => Promise.reject(new Error('not used'))),
    list: over.list ?? (() => Promise.resolve([PROJECT])),
    readArtifact: over.readArtifact ?? (() => Promise.resolve('<h1>hi</h1>')),
    readBody: over.readBody ?? (() => Promise.resolve('hi')),
    patchBlock: over.patchBlock ?? (() => Promise.resolve({ html: '<h1>patched</h1>' })),
  };
}

describe('GET /api/projects', () => {
  it('returns the project list', async () => {
    const { url, close } = await serve(fakeStore());
    try {
      const res = await fetch(`${url}/projects`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ projects: [PROJECT] });
    } finally {
      close();
    }
  });

  it('returns 500 when the store throws', async () => {
    const { url, close } = await serve(fakeStore({ list: () => Promise.reject(new Error('disk gone')) }));
    try {
      const res = await fetch(`${url}/projects`);
      expect(res.status).toBe(500);
    } finally {
      close();
    }
  });
});

describe('GET /api/projects/:id/artifact', () => {
  it('returns the HTML for a known id', async () => {
    const { url, close } = await serve(fakeStore());
    try {
      const res = await fetch(`${url}/projects/p1/artifact`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toBe('<h1>hi</h1>');
    } finally {
      close();
    }
  });

  it('returns 404 for an unknown/unsafe id', async () => {
    const { url, close } = await serve(fakeStore({ readArtifact: () => Promise.resolve(undefined) }));
    try {
      const res = await fetch(`${url}/projects/nope/artifact`);
      expect(res.status).toBe(404);
    } finally {
      close();
    }
  });
});

describe('POST /api/projects/:id/block', () => {
  async function post(url: string, body: unknown): Promise<Response> {
    return fetch(`${url}/projects/p1/block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('patches a block and returns the new HTML', async () => {
    let captured: { id: string; blockId: string; text: string } | undefined;
    const store = fakeStore({
      patchBlock: (id, blockId, text) => {
        captured = { id, blockId, text };
        return Promise.resolve({ html: '<h1>patched</h1>' });
      },
    });
    const { url, close } = await serve(store);
    try {
      const res = await post(url, { blockId: 'b1', text: '新文本' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ html: '<h1>patched</h1>' });
      expect(captured).toEqual({ id: 'p1', blockId: 'b1', text: '新文本' });
    } finally {
      close();
    }
  });

  it('rejects a missing blockId or empty text with 400', async () => {
    const { url, close } = await serve(fakeStore());
    try {
      expect((await post(url, { text: 'x' })).status).toBe(400);
      expect((await post(url, { blockId: 'b1', text: '  ' })).status).toBe(400);
    } finally {
      close();
    }
  });

  it('returns 404 when the store reports the block/project missing', async () => {
    const { url, close } = await serve(fakeStore({ patchBlock: () => Promise.resolve(undefined) }));
    try {
      expect((await post(url, { blockId: 'b9', text: 'x' })).status).toBe(404);
    } finally {
      close();
    }
  });
});
