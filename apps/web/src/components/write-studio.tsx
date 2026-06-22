'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, Hotspot, WriteSource } from '@app/contracts';
import { streamWrite } from '../lib/api/write';
import {
  listProjects,
  getArtifact,
  patchBlock,
  insertBlockAfter,
  deleteBlock,
  moveBlock,
  renameTitle,
  fetchExportHtml,
} from '../lib/api/projects';
import { listHotspots, refreshHotspots } from '../lib/api/hotspots';
import { rewrite } from '../lib/api/rewrite';
import { projectImageBase } from '../lib/api/base';
import { getBridge } from '../lib/electron';
import { ProjectSidebar } from './project-sidebar';
import { HotspotSidebar } from './hotspot-sidebar';
import { ArticleView } from './article-view';
import { BlockToolbar } from './block-toolbar';
import { RewritePanel } from './rewrite-panel';
import { EditPanel } from './edit-panel';
import { ImagePanel } from './image-panel';

type Phase = 'idle' | 'running' | 'done' | 'error';
/** Which panel is open for the selected block: the action menu, AI rewrite, or manual edit. */
type PanelMode = 'menu' | 'rewrite' | 'edit';
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
  const [panelMode, setPanelMode] = useState<PanelMode>('menu');
  const [busy, setBusy] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [rewriting, setRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState<string | undefined>(undefined);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [exporting, setExporting] = useState(false);
  const [hasBridge, setHasBridge] = useState(false);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const running = phase === 'running';

  // window.hsw exists only inside the Electron shell; PDF export degrades away in a plain browser.
  useEffect(() => {
    setHasBridge(getBridge() != null);
  }, []);

  const refreshProjects = useCallback(async (): Promise<void> => {
    try {
      setProjects(await listProjects());
    } catch {
      // listing is best-effort; the studio still works without the sidebar populated
    }
  }, []);

  const loadHotspots = useCallback(async (): Promise<void> => {
    try {
      setHotspots(await listHotspots());
    } catch {
      // best-effort; empty until the first refresh
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
    void loadHotspots();
  }, [refreshProjects, loadHotspots]);

  const doRefreshHotspots = async (): Promise<void> => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      setHotspots(await refreshHotspots());
    } catch {
      // best-effort; keep the existing list on failure
    } finally {
      setRefreshing(false);
    }
  };

  // Override lets a hotspot click pass its title + provenance explicitly, avoiding the setState
  // batching race (start() reading stale `topic` right after setTopic).
  const start = async (override?: { topic: string; source?: WriteSource }): Promise<void> => {
    const t = (override?.topic ?? topic).trim();
    if (!t || running) return;
    if (override) setTopic(t); // reflect the chosen hotspot in the input
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
              // Land in the rich project view (preview / edit / 配图 / 导出) instead of leaving the
              // user on the plain-text draft — the chain flows straight into editing.
              if (ev.projectId) void openProjectById(ev.projectId);
              else void refreshProjects();
            } else if (ev.type === 'error') {
              setPhase('error');
              setStatus(ev.message);
            }
          },
        },
        controller.signal,
        override?.source,
      );
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        setPhase('error');
        setStatus(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const onPickHotspot = (h: Hotspot): void =>
    void start({
      topic: h.title,
      source: { hotspotId: h.id, sourceType: h.sourceType, url: h.url, collectedAt: h.fetchedAt },
    });

  const stop = (): void => {
    abortRef.current?.abort();
    setPhase('idle');
    setStatus('已停止');
  };

  const clearEdit = (): void => {
    setEditMode(false);
    setSelection(null);
    setPanelMode('menu');
    setInstruction('');
    setRewriteError(undefined);
    setTitleEditing(false);
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

  // Refresh the sidebar and open the just-written project by id (used right after a write finishes).
  const openProjectById = async (id: string): Promise<void> => {
    try {
      const list = await listProjects();
      setProjects(list);
      const project = list.find((p) => p.id === id);
      if (project) await openProject(project);
    } catch {
      void refreshProjects();
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
    setPanelMode('menu'); // open the action toolbar; user picks rewrite / edit / move / insert / delete
    setInstruction('');
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

  // Structural ops renumber the positional block ids, so EVERY one re-renders from the returned HTML
  // and CLEARS the now-stale selection (same discipline as doRewrite).
  const runStructural = async (op: (id: string, blockId: string) => Promise<string>): Promise<void> => {
    if (!selected || !selection || busy) return;
    setBusy(true);
    setRewriteError(undefined);
    try {
      const html = await op(selected.id, selection.blockId);
      setSelectedHtml(html);
      setSelection(null);
      setPanelMode('menu');
    } catch (err: unknown) {
      setRewriteError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const doManualEdit = async (text: string): Promise<void> => {
    await runStructural((id, blockId) => patchBlock(id, blockId, text));
  };

  const doRenameTitle = async (): Promise<void> => {
    if (!selected) return;
    const t = titleDraft.trim();
    if (!t || t === selected.title) {
      setTitleEditing(false);
      return;
    }
    try {
      const r = await renameTitle(selected.id, t);
      setSelectedHtml(r.html);
      setSelected((s) => (s ? { ...s, title: r.title } : s));
      void refreshProjects();
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setTitleEditing(false);
    }
  };

  const exportHtml = async (): Promise<void> => {
    if (!selected || exporting) return;
    setExporting(true);
    setStatus('');
    try {
      const blob = await fetchExportHtml(selected.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeFilename(selected.title)}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus('已导出 HTML');
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  const exportPdf = async (): Promise<void> => {
    const bridge = getBridge();
    if (!bridge || !selected || exporting) return;
    setExporting(true);
    setStatus('');
    try {
      const res = await bridge.exportPdf({ projectId: selected.id, title: selected.title });
      setStatus(res.saved ? `已导出 PDF：${res.path ?? ''}` : 'PDF 导出已取消');
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
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
              {titleEditing ? (
                <input
                  style={styles.titleInput}
                  value={titleDraft}
                  autoFocus
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => void doRenameTitle()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void doRenameTitle();
                    else if (e.key === 'Escape') setTitleEditing(false);
                  }}
                />
              ) : (
                <h2
                  style={styles.viewTitle}
                  title="点击修改标题"
                  onClick={() => {
                    setTitleDraft(selected.title);
                    setTitleEditing(true);
                  }}
                >
                  {selected.title}
                </h2>
              )}
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
                <button
                  style={{ ...styles.btn, ...styles.ghostBtn }}
                  onClick={() => void exportHtml()}
                  disabled={exporting}
                >
                  导出 HTML
                </button>
                {hasBridge && (
                  <button
                    style={{ ...styles.btn, ...styles.ghostBtn }}
                    onClick={() => void exportPdf()}
                    disabled={exporting}
                  >
                    导出 PDF
                  </button>
                )}
                <button style={styles.btn} onClick={newWrite}>
                  ＋ 新写作
                </button>
              </div>
            </header>
            {status && <p style={{ ...styles.status, color: '#666' }}>{status}</p>}
            {editMode && !selection && <p style={styles.hint}>点击文章里的任意一段：可手动编辑、AI 改写、移动、插入或删除。</p>}
            {selectedHtml == null ? (
              <p style={styles.status}>加载中…</p>
            ) : (
              <ArticleView
                html={selectedHtml}
                editMode={editMode}
                imageBaseUrl={projectImageBase(selected.id)}
                onSelectBlock={onSelectBlock}
              />
            )}
            {!selection && <ImagePanel projectId={selected.id} title={selected.title} onGenerated={setSelectedHtml} />}
            {selection && panelMode === 'menu' && (
              <>
                <BlockToolbar
                  busy={busy}
                  onRewrite={() => setPanelMode('rewrite')}
                  onEdit={() => setPanelMode('edit')}
                  onMoveUp={() => void runStructural((id, b) => moveBlock(id, b, 'up'))}
                  onMoveDown={() => void runStructural((id, b) => moveBlock(id, b, 'down'))}
                  onInsertAfter={() => void runStructural((id, b) => insertBlockAfter(id, b))}
                  onDelete={() => void runStructural((id, b) => deleteBlock(id, b))}
                  onCancel={() => setSelection(null)}
                />
                {rewriteError && <p style={styles.errorLine}>{rewriteError}</p>}
              </>
            )}
            {selection && panelMode === 'rewrite' && (
              <RewritePanel
                selectedText={selection.text}
                instruction={instruction}
                rewriting={rewriting}
                error={rewriteError}
                onInstructionChange={setInstruction}
                onRewrite={() => void doRewrite()}
                onCancel={() => setPanelMode('menu')}
              />
            )}
            {selection && panelMode === 'edit' && (
              <EditPanel
                selectedText={selection.text}
                saving={busy}
                error={rewriteError}
                onSave={(text) => void doManualEdit(text)}
                onCancel={() => setPanelMode('menu')}
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

      {!selected && (
        <HotspotSidebar
          hotspots={hotspots}
          refreshing={refreshing}
          onSelect={onPickHotspot}
          onRefresh={() => void doRefreshHotspots()}
        />
      )}
    </section>
  );
}

/** Make a project title safe as a download filename (strip path/illegal chars; fall back). */
function safeFilename(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned || 'article';
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
  viewTitle: { margin: 0, fontSize: 20, color: '#1a1a1a', cursor: 'text' },
  titleInput: {
    margin: 0,
    flex: 1,
    minWidth: 0,
    marginRight: 12,
    padding: '4px 8px',
    fontSize: 20,
    color: '#1a1a1a',
    border: '1px solid #2ecc71',
    borderRadius: 6,
    outline: 'none',
  },
  errorLine: { marginTop: 8, fontSize: 13, color: '#c0392b' },
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
