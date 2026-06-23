import { describe, it, expect, vi, afterEach } from 'vitest';
import { openCase, promoteToCase } from './cases';
import type { MaterialCard, Project } from '@app/contracts';

afterEach(() => vi.unstubAllGlobals());

const PROJECT = { id: 'c1', dir: '/p/c1', title: '远程办公', createdAt: 'n', stage: 'corpus' } as Project;
const CARD = { id: 'a', kind: 'text', origin: 'manual', klass: '原始', confidence: 1, tags: [], note: '', addedAt: 'n', content: { body: 'b' } } as MaterialCard;

function stub(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(body) } as unknown as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('cases api client', () => {
  it('openCase POSTs the title to /api/cases and returns the project', async () => {
    const f = stub({ project: PROJECT });
    expect(await openCase('远程办公')).toEqual(PROJECT);
    const [u, init] = f.mock.calls[0] as [string, RequestInit];
    expect(String(u)).toMatch(/\/api\/cases$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ title: '远程办公' });
  });

  it('openCase includes the angle when given', async () => {
    const f = stub({ project: PROJECT });
    await openCase('t', 'a sharp angle');
    expect(JSON.parse((f.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({ title: 't', angle: 'a sharp angle' });
  });

  it('promoteToCase POSTs inboxIds and returns the promoted cards', async () => {
    const f = stub({ promoted: [CARD] });
    expect(await promoteToCase('c1', ['a', 'b'])).toEqual([CARD]);
    const [u, init] = f.mock.calls[0] as [string, RequestInit];
    expect(String(u)).toContain('/projects/c1/materials/promote');
    expect(JSON.parse(init.body as string)).toEqual({ inboxIds: ['a', 'b'] });
  });

  it('throws on a non-ok response', async () => {
    stub({}, false, 400);
    await expect(openCase('x')).rejects.toThrow(/open case failed: 400/);
    stub({}, false, 404);
    await expect(promoteToCase('c1', ['a'])).rejects.toThrow(/promote failed: 404/);
  });
});
