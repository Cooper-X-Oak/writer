import { describe, it, expect, vi, afterEach } from 'vitest';
import { listProjects, getArtifact, patchBlock } from './projects';
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
    await expect(patchBlock('p1', 'b9', 'x')).rejects.toThrow(/patch block failed: 404/);
  });
});
