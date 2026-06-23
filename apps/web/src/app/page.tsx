// Server component (no 'use client') — renders the client app shell. Keeping the page a server
// component avoids a Next 15.5 RSC bundler bug that drops a fully-client page from the client
// manifest during static prerender ("Could not find page.tsx#default in the React Client Manifest").

import { AgentGuide } from '../components/agent-guide';
import { WriteStudio } from '../components/write-studio';
import { DaemonStatus } from '../components/daemon-status';

export default function Home() {
  return (
    <main className="app-desk grain" style={{ padding: '30px 32px', color: 'var(--ink)' }}>
      <header style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: 'var(--ink)',
          }}
        >
          案台<span style={{ fontSize: 15, color: 'var(--ink-muted)', fontWeight: 400, marginLeft: 10 }}>· Hotspot Writer</span>
        </h1>
        <DaemonStatus />
      </header>

      <div style={{ position: 'relative', zIndex: 1 }}>
        <AgentGuide />
        <WriteStudio />
      </div>
    </main>
  );
}
