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

const PROJECT: Project = { id: 'p1', dir: '/p/p1', title: '标题', createdAt: '2026-06-22T00:00:00.000Z', stage: 'draft' };

function fakeStore(over: Partial<ProjectStore> = {}): ProjectStore {
  return {
    create: over.create ?? (() => Promise.reject(new Error('not used'))),
    createCorpus: over.createCorpus ?? (() => Promise.resolve({ ...PROJECT, stage: 'corpus' })),
    commitDraft: over.commitDraft ?? (() => Promise.resolve({ id: 'p1' })),
    list: over.list ?? (() => Promise.resolve([PROJECT])),
    readArtifact: over.readArtifact ?? (() => Promise.resolve('<h1>hi</h1>')),
    readBody: over.readBody ?? (() => Promise.resolve('hi')),
    patchBlock: over.patchBlock ?? (() => Promise.resolve({ html: '<h1>patched</h1>' })),
    addImage: over.addImage ?? (() => Promise.resolve({ html: '<figure></figure>', name: 'img.png' })),
    readImage: over.readImage ?? (() => Promise.resolve({ bytes: Buffer.from([1, 2, 3]), contentType: 'image/png' })),
    exportHtml: over.exportHtml ?? (() => Promise.resolve('<!doctype html><h1>export</h1>')),
    insertBlockAfter: over.insertBlockAfter ?? (() => Promise.resolve({ html: '<h1>inserted</h1>' })),
    deleteBlock: over.deleteBlock ?? (() => Promise.resolve({ html: '<h1>deleted</h1>' })),
    moveBlock: over.moveBlock ?? (() => Promise.resolve({ html: '<h1>moved</h1>' })),
    renameTitle: over.renameTitle ?? (() => Promise.resolve({ html: '<h1>新</h1>', title: '新' })),
    deleteProject: over.deleteProject ?? (() => Promise.resolve({ id: 'p1' })),
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

describe('GET /api/projects/:id/export/html', () => {
  it('returns the self-contained HTML as a download attachment', async () => {
    const { url, close } = await serve(fakeStore());
    try {
      const res = await fetch(`${url}/projects/p1/export/html`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('content-disposition')).toContain('attachment');
      expect(res.headers.get('content-disposition')).toContain('article-p1.html');
      expect(await res.text()).toBe('<!doctype html><h1>export</h1>');
    } finally {
      close();
    }
  });

  it('returns 404 for an unknown/unsafe id', async () => {
    const { url, close } = await serve(fakeStore({ exportHtml: () => Promise.resolve(undefined) }));
    try {
      expect((await fetch(`${url}/projects/nope/export/html`)).status).toBe(404);
    } finally {
      close();
    }
  });

  it('returns 500 when the store throws', async () => {
    const { url, close } = await serve(fakeStore({ exportHtml: () => Promise.reject(new Error('boom')) }));
    try {
      expect((await fetch(`${url}/projects/p1/export/html`)).status).toBe(500);
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

describe('DELETE /api/projects/:id', () => {
  it('returns 204 on success (store called with the id)', async () => {
    let captured = '';
    const store = fakeStore({ deleteProject: (id) => { captured = id; return Promise.resolve({ id }); } });
    const { url, close } = await serve(store);
    try {
      const res = await fetch(`${url}/projects/p1`, { method: 'DELETE' });
      expect(res.status).toBe(204);
      expect(captured).toBe('p1');
    } finally { close(); }
  });
  it('returns 404 for an unknown/unsafe id and 500 on throw', async () => {
    const miss = await serve(fakeStore({ deleteProject: () => Promise.resolve(undefined) }));
    try {
      expect((await fetch(`${miss.url}/projects/nope`, { method: 'DELETE' })).status).toBe(404);
    } finally { miss.close(); }
    const boom = await serve(fakeStore({ deleteProject: () => Promise.reject(new Error('rm fail')) }));
    try {
      expect((await fetch(`${boom.url}/projects/p1`, { method: 'DELETE' })).status).toBe(500);
    } finally { boom.close(); }
  });
});

describe('structural block ops + rename', () => {
  async function post(url: string, path: string, body: unknown): Promise<Response> {
    return fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  it('POST /block/insert returns {html}; 400 without blockId; 404 when store→undefined', async () => {
    let captured: { id: string; blockId: string; text: string } | undefined;
    const store = fakeStore({ insertBlockAfter: (id, blockId, text) => { captured = { id, blockId, text }; return Promise.resolve({ html: '<h1>x</h1>' }); } });
    const { url, close } = await serve(store);
    try {
      expect((await post(url, '/projects/p1/block/insert', { blockId: 'b0', text: 'hi' })).status).toBe(200);
      expect(captured).toEqual({ id: 'p1', blockId: 'b0', text: 'hi' });
      expect((await post(url, '/projects/p1/block/insert', { text: 'x' })).status).toBe(400);
    } finally { close(); }
  });

  it('POST /block/delete returns {html}; 400 without blockId; 404 when missing', async () => {
    const { url, close } = await serve(fakeStore());
    try {
      expect((await post(url, '/projects/p1/block/delete', { blockId: 'b1' })).status).toBe(200);
      expect((await post(url, '/projects/p1/block/delete', {})).status).toBe(400);
    } finally { close(); }
    const miss = await serve(fakeStore({ deleteBlock: () => Promise.resolve(undefined) }));
    try {
      expect((await post(miss.url, '/projects/p1/block/delete', { blockId: 'b9' })).status).toBe(404);
    } finally { miss.close(); }
  });

  it('POST /block/move validates direction (up|down) and returns {html}', async () => {
    let dir: string | undefined;
    const store = fakeStore({ moveBlock: (_id, _b, d) => { dir = d; return Promise.resolve({ html: '<h1>m</h1>' }); } });
    const { url, close } = await serve(store);
    try {
      expect((await post(url, '/projects/p1/block/move', { blockId: 'b1', direction: 'down' })).status).toBe(200);
      expect(dir).toBe('down');
      expect((await post(url, '/projects/p1/block/move', { blockId: 'b1', direction: 'sideways' })).status).toBe(400);
      expect((await post(url, '/projects/p1/block/move', { blockId: 'b1' })).status).toBe(400);
    } finally { close(); }
  });

  it('PATCH /title returns {html,title}; 400 on blank; 404 when missing', async () => {
    const store = fakeStore();
    const { url, close } = await serve(store);
    const patch = (body: unknown) => fetch(`${url}/projects/p1/title`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
      const res = await patch({ title: '新标题' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ html: '<h1>新</h1>', title: '新' });
      expect((await patch({ title: '   ' })).status).toBe(400);
    } finally { close(); }
    const miss = await serve(fakeStore({ renameTitle: () => Promise.resolve(undefined) }));
    try {
      expect((await fetch(`${miss.url}/projects/nope/title`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x' }) })).status).toBe(404);
    } finally { miss.close(); }
  });
});

describe('image endpoints', () => {
  it('POST /projects/:id/image accepts raw bytes and returns {html,name}', async () => {
    let captured: { id: string; contentType: string; alt?: string; len: number } | undefined;
    const store = fakeStore({
      addImage: (id, input) => {
        captured = { id, contentType: input.contentType, alt: input.alt, len: input.bytes.length };
        return Promise.resolve({ html: '<figure></figure>', name: 'abc.png' });
      },
    });
    const { url, close } = await serve(store);
    try {
      const res = await fetch(`${url}/projects/p1/image?alt=cap`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: new Uint8Array([1, 2, 3, 4]),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ html: '<figure></figure>', name: 'abc.png' });
      expect(captured).toEqual({ id: 'p1', contentType: 'image/png', alt: 'cap', len: 4 });
    } finally {
      close();
    }
  });

  it('POST image returns 404 when the store rejects it (bad type/project)', async () => {
    const { url, close } = await serve(fakeStore({ addImage: () => Promise.resolve(undefined) }));
    try {
      const res = await fetch(`${url}/projects/p1/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: new Uint8Array([1]),
      });
      expect(res.status).toBe(404);
    } finally {
      close();
    }
  });

  it('GET /projects/:id/images/:name serves bytes with the content-type', async () => {
    const { url, close } = await serve(fakeStore());
    try {
      const res = await fetch(`${url}/projects/p1/images/img.png`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('image/png');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    } finally {
      close();
    }
  });

  it('GET image returns 404 when unknown', async () => {
    const { url, close } = await serve(fakeStore({ readImage: () => Promise.resolve(undefined) }));
    try {
      expect((await fetch(`${url}/projects/p1/images/nope.png`)).status).toBe(404);
    } finally {
      close();
    }
  });
});
