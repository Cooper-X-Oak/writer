import { describe, it, expect, vi, afterEach } from 'vitest';
import { getAgentDiagnosis } from './agent';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getAgentDiagnosis', () => {
  it('parses the diagnosis DTO', async () => {
    const body = {
      agentId: 'claude',
      agentName: 'Claude Code',
      state: 'NOT_INSTALLED',
      ready: false,
      title: 'Claude Code is not installed',
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    await expect(getAgentDiagnosis()).resolves.toMatchObject({ agentId: 'claude', ready: false });
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    await expect(getAgentDiagnosis()).rejects.toThrow(/500/);
  });
});
