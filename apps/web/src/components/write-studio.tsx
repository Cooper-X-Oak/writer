'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '@app/contracts';
import { streamWrite } from '../lib/api/write';
import { listProjects, getArtifact } from '../lib/api/projects';
import { ProjectSidebar } from './project-sidebar';
import { ArticleView } from './article-view';

type Phase = 'idle' | 'running' | 'done' | 'error';

export function WriteStudio() {
  const [topic, setTopic] = useState('');
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [selectedHtml, setSelectedHtml] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const running = phase === 'running';

  const refreshProjects = useCallback(async (): Promise<void> => {
    try {
      setProjects(await listProjects());
    } catch {
      // listing is best-effort; the studio still works without the sidebar populated
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const start = async (): Promise<void> => {
    const t = topic.trim();
    if (!t || running) return;
    setSelected(null);
    setSelectedHtml(null);
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
              setStatus(ev.costUsd != null ? `完成 · 已保存 · $${ev.costUsd.toFixed(4)}` : '完成 · 已保存');
              void refreshProjects();
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

  const openProject = async (project: Project): Promise<void> => {
    setSelected(project);
    setSelectedHtml(null);
    try {
      setSelectedHtml(await getArtifact(project.id));
    } catch (err: unknown) {
      setSelectedHtml(null);
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const newWrite = (): void => {
    setSelected(null);
    setSelectedHtml(null);
    setDraft('');
    setStatus('');
    setPhase('idle');
  };

  return (
    <section style={styles.layout}>
      <ProjectSidebar
        projects={projects}
        selectedId={selected?.id ?? null}
        onSelect={(p) => void openProject(p)}
        onNew={newWrite}
      />

      <div style={styles.main}>
        {selected ? (
          <div>
            <header style={styles.viewHeader}>
              <h2 style={styles.viewTitle}>{selected.title}</h2>
              <button style={styles.btn} onClick={newWrite}>
                ＋ 新写作
              </button>
            </header>
            {selectedHtml == null ? <p style={styles.status}>加载中…</p> : <ArticleView html={selectedHtml} />}
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  layout: { marginTop: 24, display: 'flex', gap: 24, alignItems: 'flex-start' },
  main: { flex: 1, minWidth: 0, maxWidth: 720 },
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
  viewHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  viewTitle: { margin: 0, fontSize: 20, color: '#1a1a1a' },
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
