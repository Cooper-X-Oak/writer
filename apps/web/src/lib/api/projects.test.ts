import { describe, it, expect, vi, afterEach } from 'vitest';
import { listProjects, getArtifact, patchBlock, exportHtmlUrl, fetchExportHtml, insertBlockAfter, deleteBlock, moveBlock, renameTitle, deleteProject } from './projects';
import type { Project } from '@app/contracts';

afterEach(() => vi.unstubAllGlobals());

const PROJECT: Project = { id: 'p1', dir: '/p/p1', title: '标题', createdAt: '2026-06-22T00:00:00.000Z' };

describe('listProjects', () => {
  it('returns the projects array from the envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ projects: [PROJECT] }) } as unknown as Response),
    );
    expect(await listProjects()).toEqual([PROJECT]);
  });

  it('tolerates a missing projects field as an empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response),
    );
    expect(await listProjects()).toEqual([]);
  });

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as unknown as Response));
    await expect(listProjects()).rejects.toThrow(/list projects failed: 500/);
  });
});

describe('getArtifact', () => {
  it('returns the HTML body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('<h1>hi</h1>') } as unknown as Response),
    );
    expect(await getArtifact('p1')).toBe('<h1>hi</h1>');
  });

  it('encodes the id into the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    await getArtifact('a/b');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/projects/a%2Fb/artifact');
  });

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 } as unknown as Response));
    await expect(getArtifact('nope')).rejects.toThrow(/load artifact failed: 404/);
  });
});

describe('exportHtmlUrl', () => {
  it('builds the export endpoint with the id encoded', () => {
    expect(exportHtmlUrl('a/b')).toContain('/projects/a%2Fb/export/html');
  });
});

describe('fetchExportHtml', () => {
  it('returns the response blob', async () => {
    const blob = new Blob(['<html></html>'], { type: 'text/html' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) } as unknown as Response));
    expect(await fetchExportHtml('p1')).toBe(blob);
  });

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 } as unknown as Response));
    await expect(fetchExportHtml('nope')).rejects.toThrow(/export failed: 404/);
  });
});

describe('patchBlock', () => {
  it('POSTs the block + text and returns the new HTML', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ html: '<h1>new</h1>' }) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    expect(await patchBlock('p1', 'b1', '新文本')).toBe('<h1>new</h1>');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ blockId: 'b1', text: '新文本' });
  });

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 } as unknown as Response));
    await expect(patchBlock('p1', 'b9', 'x')).rejects.toThrow(/block patch failed: 404/);
  });
});

describe('structural block ops', () => {
  const okHtml = (html: string) =>
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ html }) } as unknown as Response);

  it('insertBlockAfter / deleteBlock / moveBlock POST the right URL+body and return html', async () => {
    const fetchMock = okHtml('<h1>new</h1>');
    vi.stubGlobal('fetch', fetchMock);
    expect(await insertBlockAfter('p1', 'b0', 'hi')).toBe('<h1>new</h1>');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/block/insert');

    expect(await deleteBlock('p1', 'b1')).toBe('<h1>new</h1>');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/block/delete');

    expect(await moveBlock('p1', 'b1', 'up')).toBe('<h1>new</h1>');
    const [, moveInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(JSON.parse(String(moveInit.body))).toEqual({ blockId: 'b1', direction: 'up' });
  });

  it('renameTitle PATCHes /title and returns {html,title}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ html: '<h1>新</h1>', title: '新' }) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    expect(await renameTitle('p1', '新')).toEqual({ html: '<h1>新</h1>', title: '新' });
    const [u, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(u)).toContain('/projects/p1/title');
    expect(init.method).toBe('PATCH');
  });

  it('throw on non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as unknown as Response));
    await expect(insertBlockAfter('p1', 'b0')).rejects.toThrow(/block \/insert failed: 500/);
    await expect(renameTitle('p1', 'x')).rejects.toThrow(/rename failed: 500/);
  });
});

describe('deleteProject', () => {
  it('DELETEs the project and resolves on 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteProject('a/b')).resolves.toBeUndefined();
    const [u, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(u)).toContain('/projects/a%2Fb');
    expect(init.method).toBe('DELETE');
  });
  it('throws on non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 } as unknown as Response));
    await expect(deleteProject('p1')).rejects.toThrow(/delete project failed: 404/);
  });
});
