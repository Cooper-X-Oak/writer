'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '@app/contracts';
import { streamWrite } from '../lib/api/write';
import { listProjects, getArtifact, patchBlock } from '../lib/api/projects';
import { rewrite } from '../lib/api/rewrite';
import { ProjectSidebar } from './project-sidebar';
import { ArticleView } from './article-view';
import { RewritePanel } from './rewrite-panel';

type Phase = 'idle' | 'running' | 'done' | 'error';
interface Selection {
  blockId: string;
  text: string;
}

export function WriteStudio() {
  const [topic, setTopic] = useState('');
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [selectedHtml, setSelectedHtml] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [instruction, setInstruction] = useState('');
  const [rewriting, setRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState<string | undefined>(undefined);
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

  const clearEdit = (): void => {
    setEditMode(false);
    setSelection(null);
    setInstruction('');
    setRewriteError(undefined);
  };

  const openProject = async (project: Project): Promise<void> => {
    setSelected(project);
    setSelectedHtml(null);
    clearEdit();
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
    clearEdit();
    setDraft('');
    setStatus('');
    setPhase('idle');
  };

  const onSelectBlock = useCallback((blockId: string, text: string): void => {
    setSelection({ blockId, text });
    setRewriteError(undefined);
  }, []);

  const doRewrite = async (): Promise<void> => {
    if (!selected || !selection || rewriting) return;
    setRewriting(true);
    setRewriteError(undefined);
    try {
      const newText = await rewrite(selection.text, instruction);
      const html = await patchBlock(selected.id, selection.blockId, newText);
      setSelectedHtml(html); // re-render the iframe with the patched article (already persisted)
      setSelection(null);
      setInstruction('');
    } catch (err: unknown) {
      setRewriteError(err instanceof Error ? err.message : String(err));
    } finally {
      setRewriting(false);
    }
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
              <div style={styles.viewActions}>
                <button
                  style={{ ...styles.btn, ...styles.ghostBtn, ...(editMode ? styles.editOn : null) }}
                  onClick={() => {
                    setEditMode((v) => !v);
                    setSelection(null);
                  }}
                >
                  {editMode ? '✓ 编辑中' : '编辑'}
                </button>
                <button style={styles.btn} onClick={newWrite}>
                  ＋ 新写作
                </button>
              </div>
            </header>
            {editMode && !selection && <p style={styles.hint}>点击文章里的任意一段，让 AI 帮你改写。</p>}
            {selectedHtml == null ? (
              <p style={styles.status}>加载中…</p>
            ) : (
              <ArticleView html={selectedHtml} editMode={editMode} onSelectBlock={onSelectBlock} />
            )}
            {selection && (
              <RewritePanel
                selectedText={selection.text}
                instruction={instruction}
                rewriting={rewriting}
                error={rewriteError}
                onInstructionChange={setInstruction}
                onRewrite={() => void doRewrite()}
                onCancel={() => {
                  setSelection(null);
                  setRewriteError(undefined);
                }}
              />
            )}
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
  viewActions: { display: 'flex', gap: 8 },
  ghostBtn: { color: '#111', background: '#fff', border: '1px solid #d0d0d0' },
  editOn: { color: '#fff', background: '#2ecc71', border: '1px solid #2ecc71' },
  hint: { margin: '0 0 12px', fontSize: 13, color: '#2e8b57' },
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
