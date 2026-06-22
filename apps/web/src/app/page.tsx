'use client';

import { useEffect, useState } from 'react';
import type { Health } from '@app/contracts';
import { getHealth } from '../lib/api/health';
import { AgentGuide } from '../components/agent-guide';
import { WriteStudio } from '../components/write-studio';

export default function Home() {
  const [daemonOk, setDaemonOk] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((h: Health) => {
        if (!cancelled) setDaemonOk(h.status === 'ok');
      })
      .catch(() => {
        if (!cancelled) setDaemonOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '32px 28px', color: '#111' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 26, letterSpacing: -0.5 }}>Hotspot Writer</h1>
        <span style={{ fontSize: 12, color: daemonOk ? '#2ecc71' : '#bbb' }}>
          {daemonOk === null ? '连接中…' : daemonOk ? '● daemon 在线' : '○ daemon 离线'}
        </span>
      </header>

      <AgentGuide />
      <WriteStudio />
    </main>
  );
}
