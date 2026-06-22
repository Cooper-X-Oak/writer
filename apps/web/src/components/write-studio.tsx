'use client';

import { useRef, useState } from 'react';
import { streamWrite } from '../lib/api/write';

type Phase = 'idle' | 'running' | 'done' | 'error';

export function WriteStudio() {
  const [topic, setTopic] = useState('');
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const abortRef = useRef<AbortController | null>(null);

  const running = phase === 'running';

  const start = async (): Promise<void> => {
    const t = topic.trim();
    if (!t || running) return;
    setDraft('');
    setStatus('');
    setPhase('running');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamWrite(
        t,
        {
          onEvent: (ev) => {
            if (ev.type === 'delta') setDraft((d) => d + ev.text);
            else if (ev.type === 'status') setStatus(ev.message);
            else if (ev.type === 'done') {
              setPhase('done');
              setStatus(ev.costUsd != null ? `完成 · $${ev.costUsd.toFixed(4)}` : '完成');
            } else if (ev.type === 'error') {
              setPhase('error');
              setStatus(ev.message);
            }
          },
        },
        controller.signal,
      );
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        setPhase('error');
        setStatus(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const stop = (): void => {
    abortRef.current?.abort();
    setPhase('idle');
    setStatus('已停止');
  };

  return (
    <section style={styles.wrap}>
      <div style={styles.inputRow}>
        <input
          style={styles.input}
          value={topic}
          placeholder="输入一个热点主题，例如：AI 编程助手正在改变初级开发者的价值"
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void start();
          }}
          disabled={running}
        />
        {running ? (
          <button style={{ ...styles.btn, ...styles.stopBtn }} onClick={stop}>
            停止
          </button>
        ) : (
          <button style={styles.btn} onClick={() => void start()} disabled={!topic.trim()}>
            写作
          </button>
        )}
      </div>

      {status && (
        <p style={{ ...styles.status, color: phase === 'error' ? '#c0392b' : '#666' }}>
          {running && <span style={styles.pulse} />}
          {status}
        </p>
      )}

      {draft && (
        <article style={styles.draft}>
          {draft}
          {running && <span style={styles.caret} />}
        </article>
      )}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 24, maxWidth: 720 },
  inputRow: { display: 'flex', gap: 8 },
  input: {
    flex: 1,
    padding: '10px 12px',
    fontSize: 15,
    border: '1px solid #d0d0d0',
    borderRadius: 8,
    outline: 'none',
  },
  btn: {
    padding: '10px 18px',
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
    background: '#111',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  stopBtn: { background: '#c0392b' },
  status: { marginTop: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 },
  pulse: {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#2ecc71',
    animation: 'none',
  },
  draft: {
    marginTop: 16,
    padding: '20px 24px',
    background: '#fafafa',
    border: '1px solid #ececec',
    borderRadius: 12,
    lineHeight: 1.85,
    fontSize: 16,
    color: '#1a1a1a',
    whiteSpace: 'pre-wrap',
  },
  caret: {
    display: 'inline-block',
    width: 8,
    height: 18,
    marginLeft: 2,
    background: '#111',
    verticalAlign: 'text-bottom',
  },
};
