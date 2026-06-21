import type { AgentDiagnosis } from '@app/contracts';

const DAEMON_URL = process.env.NEXT_PUBLIC_DAEMON_URL ?? 'http://127.0.0.1:4319';

export async function getAgentDiagnosis(): Promise<AgentDiagnosis> {
  const res = await fetch(`${DAEMON_URL}/api/agent/detect`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`agent detect failed: ${res.status}`);
  return (await res.json()) as AgentDiagnosis;
}
