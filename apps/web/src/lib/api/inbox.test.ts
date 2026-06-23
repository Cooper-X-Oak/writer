import { describe, it, expect, vi, afterEach } from 'vitest';
import { listInbox, addInboxLink, addInboxText, addInboxImage, addInboxHotspot, removeInboxItem } from './inbox';
import type { MaterialCard } from '@app/contracts';

afterEach(() => vi.unstubAllGlobals());

const CARD = { id: 'a', kind: 'text', origin: 'manual', klass: '原始', confidence: 1, tags: [], note: '', addedAt: 'n', content: { body: 'b' } } as MaterialCard;

function stub(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(body) } as unknown as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('inbox api client (global, no project)', () => {
  it('listInbox reads {items} and tolerates absence', async () => {
    stub({ items: [CARD] });
    expect(await listInbox()).toEqual([CARD]);
    stub({});
    expect(await listInbox()).toEqual([]);
  });

  it('addInboxLink posts kind=link to /api/inbox and returns the item', async () => {
    const f = stub({ item: CARD });
    expect(await addInboxLink({ url: 'https://x/1', excerpt: 'e' })).toEqual(CARD);
    const [u, init] = f.mock.calls[0] as [string, RequestInit];
    expect(String(u)).toMatch(/\/api\/inbox$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({ kind: 'link', url: 'https://x/1' });
  });

  it('addInboxText posts the text kind verbatim', async () => {
    const f = stub({ item: CARD });
    await addInboxText({ kind: 'md', body: '# h' });
    expect(JSON.parse((f.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({ kind: 'md', body: '# h' });
  });

  it('addInboxImage sends raw bytes with the file content-type to /inbox/image', async () => {
    const f = stub({ item: CARD });
    const file = new File([new Uint8Array([1, 2])], 'cat.png', { type: 'image/png' });
    await addInboxImage(file);
    const [u, init] = f.mock.calls[0] as [string, RequestInit];
    expect(String(u)).toContain('/inbox/image?alt=cat.png');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/png');
  });

  it('addInboxHotspot posts the hotspotId; removeInboxItem DELETEs', async () => {
    const f = stub({ item: CARD });
    await addInboxHotspot('hn-1');
    const [u, init] = f.mock.calls[0] as [string, RequestInit];
    expect(String(u)).toContain('/inbox/from-hotspot');
    expect(JSON.parse(init.body as string)).toEqual({ hotspotId: 'hn-1' });
    const d = stub({}, true, 204);
    await removeInboxItem('a');
    expect((d.mock.calls[0] as [string, RequestInit])[1].method).toBe('DELETE');
  });

  it('throws on a non-ok response', async () => {
    stub({}, false, 500);
    await expect(listInbox()).rejects.toThrow(/list inbox failed: 500/);
  });
});
