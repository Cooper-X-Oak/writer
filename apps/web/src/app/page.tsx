// Server component (no 'use client') — renders the client app shell. Keeping the page a server
// component avoids a Next 15.5 RSC bundler bug that drops a fully-client page from the client
// manifest during static prerender ("Could not find page.tsx#default in the React Client Manifest").

import { AgentGuide } from '../components/agent-guide';
import { WriteStudio } from '../components/write-studio';
import { DaemonStatus } from '../components/daemon-status';

export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '32px 28px', color: '#111' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 26, letterSpacing: -0.5 }}>Hotspot Writer</h1>
        <DaemonStatus />
      </header>

      <AgentGuide />
      <WriteStudio />
    </main>
  );
}
