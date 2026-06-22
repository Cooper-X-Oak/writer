import { describe, it, expect, vi, afterEach } from 'vitest';
import { createCorpusProject, listMaterials, addLinkCard, addImageCard, addHotspotCard, removeCard } from './corpus';
import type { MaterialCard, Project } from '@app/contracts';

afterEach(() => vi.unstubAllGlobals());

const CARD = { id: 'a', kind: 'text', origin: 'manual', klass: '原始', confidence: 1, tags: [], note: '', addedAt: 'n', content: { body: 'b' } } as MaterialCard;
const PROJECT = { id: 'c1', dir: '/p/c1', title: 'x', createdAt: 'n', stage: 'corpus' } as Project;

function stub(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(body) } as unknown as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('corpus api client', () => {
  it('createCorpusProject POSTs to /projects/corpus and returns the project', async () => {
    const f = stub({ project: PROJECT });
    expect(await createCorpusProject('x')).toEqual(PROJECT);
    const [u, init] = f.mock.calls[0] as [string, RequestInit];
    expect(String(u)).toContain('/projects/corpus');
    expect(init.method).toBe('POST');
  });

  it('listMaterials reads {cards} and tolerates absence', async () => {
    stub({ cards: [CARD] });
    expect(await listMaterials('c1')).toEqual([CARD]);
    stub({});
    expect(await listMaterials('c1')).toEqual([]);
  });

  it('addLinkCard posts kind=link and returns the card', async () => {
    const f = stub({ card: CARD });
    expect(await addLinkCard('c1', { url: 'https://x/1', excerpt: 'e' })).toEqual(CARD);
    const init = (f.mock.calls[0] as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string)).toMatchObject({ kind: 'link', url: 'https://x/1' });
  });

  it('addImageCard sends raw bytes with the file content-type', async () => {
    const f = stub({ card: CARD });
    const file = new File([new Uint8Array([1, 2])], 'cat.png', { type: 'image/png' });
    await addImageCard('c1', file);
    const [u, init] = f.mock.calls[0] as [string, RequestInit];
    expect(String(u)).toContain('/materials/image?alt=cat.png');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/png');
  });

  it('addHotspotCard posts the hotspotId; removeCard DELETEs', async () => {
    const f = stub({ card: CARD });
    await addHotspotCard('c1', 'hn-1');
    expect(JSON.parse((f.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({ hotspotId: 'hn-1' });
    const d = stub({}, true, 204);
    await removeCard('c1', 'a');
    expect((d.mock.calls[0] as [string, RequestInit])[1].method).toBe('DELETE');
  });

  it('throws on a non-ok response', async () => {
    stub({}, false, 500);
    await expect(listMaterials('c1')).rejects.toThrow(/list materials failed: 500/);
  });
});
