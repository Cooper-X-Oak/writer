'use client';

import { useEffect, useState } from 'react';
import type { AgentDiagnosis } from '@app/contracts';
import { getAgentDiagnosis } from '../lib/api/agent';

export function AgentGuide() {
  const [diag, setDiag] = useState<AgentDiagnosis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAgentDiagnosis()
      .then((d) => {
        if (!cancelled) setDiag(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p>agent check failed: {error}</p>;
  if (!diag) return <p>checking coding agent…</p>;

  return (
    <section style={{ marginTop: 16 }}>
      <p>
        {diag.ready ? '✅' : '⚠️'} {diag.title}
      </p>
      {diag.detail && <p style={{ opacity: 0.7 }}>{diag.detail}</p>}
      {diag.fix && (
        <p>
          {diag.fix.href ? (
            <a href={diag.fix.href} target="_blank" rel="noopener noreferrer">
              {diag.fix.label}
            </a>
          ) : (
            diag.fix.label
          )}
          {diag.fix.command && <code> — {diag.fix.command}</code>}
        </p>
      )}
    </section>
  );
}
