'use client';

import { useEffect, useState } from 'react';
import type { Health } from '@app/contracts';
import { getHealth } from '../lib/api/health';

/** The daemon-online badge. Client-only (polls /health) so the page can stay a server component. */
export function DaemonStatus() {
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
    <span style={{ fontSize: 12, color: daemonOk ? '#2ecc71' : '#bbb' }}>
      {daemonOk === null ? '连接中…' : daemonOk ? '● daemon 在线' : '○ daemon 离线'}
    </span>
  );
}
