'use client';

import { useEffect, useState } from 'react';
import type { Health } from '@app/contracts';
import { getHealth } from '../lib/api/health';
import { AgentGuide } from '../components/agent-guide';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; health: Health }
  | { kind: 'error'; message: string };

export default function Home() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((health) => {
        if (!cancelled) setState({ kind: 'ok', health });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>Hotspot Writer</h1>
      {state.kind === 'loading' && <p>checking daemon…</p>}
      {state.kind === 'ok' && (
        <p>
          daemon ok — version {state.health.version} — uptime {state.health.uptimeMs}ms
        </p>
      )}
      {state.kind === 'error' && <p>daemon unreachable: {state.message}</p>}
      <AgentGuide />
    </main>
  );
}
