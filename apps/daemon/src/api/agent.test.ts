import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createAgentRouter } from './agent.js';
import type { AgentDiagnosis } from '@app/contracts';

async function listenWith(detect: () => Promise<{ state: 'NOT_INSTALLED' | 'READY'; version?: string }>) {
  const app = express();
  app.use('/api', createAgentRouter(detect));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return { port, close: () => server.close() };
}

describe('GET /api/agent/detect', () => {
  it('returns a NOT_INSTALLED diagnosis with an install fix', async () => {
    const { port, close } = await listenWith(async () => ({ state: 'NOT_INSTALLED' }));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/agent/detect`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as AgentDiagnosis;
      expect(body).toMatchObject({ agentId: 'claude', state: 'NOT_INSTALLED', ready: false });
      expect(body.fix?.label).toMatch(/install/i);
    } finally {
      close();
    }
  });

  it('reports ready when the detector says READY', async () => {
    const { port, close } = await listenWith(async () => ({ state: 'READY', version: '2.1.185' }));
    try {
      const body = (await (await fetch(`http://127.0.0.1:${port}/api/agent/detect`)).json()) as AgentDiagnosis;
      expect(body).toMatchObject({ state: 'READY', ready: true });
    } finally {
      close();
    }
  });
});
