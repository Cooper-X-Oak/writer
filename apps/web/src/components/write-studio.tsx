'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, Hotspot, MaterialCard } from '@app/contracts';
import { streamWrite } from '../lib/api/write';
import {
  createCorpusProject,
  listMaterials,
  addLinkCard,
  addTextCard,
  addCodeCard,
  addImageCard,
  addHotspotCard,
  removeCard,
} from '../lib/api/corpus';
import { CorpusSidebar } from './corpus-sidebar';
import {
  listProjects,
  getArtifact,
  patchBlock,
  insertBlockAfter,
  deleteBlock,
  moveBlock,
  renameTitle,
  deleteProject,
  fetchExportHtml,
} from '../lib/api/projects';
import { listHotspots, refreshHotspots, dismissHotspot } from '../lib/api/hotspots';
import { listFeeds, addFeed, removeFeed } from '../lib/api/feeds';
import { rewrite } from '../lib/api/rewrite';
import { projectImageBase } from '../lib/api/base';
import { getBridge } from '../lib/electron';
import { ProjectSidebar } from './project-sidebar';
import { HotspotSidebar } from './hotspot-sidebar';
import { FeedManager } from './feed-manager';
import { ArticleView } from './article-view';
import { ProvenanceLine } from './provenance-line';
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
  const [feeds, setFeeds] = useState<string[]>([]);
  const [feedsBusy, setFeedsBusy] = useState(false);
  const [cards, setCards] = useState<MaterialCard[]>([]);
  const [corpusBusy, setCorpusBusy] = useState(false);
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

  const loadFeeds = useCallback(async (): Promise<void> => {
    try {
      setFeeds(await listFeeds());
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
    void loadHotspots();
    void loadFeeds();
  }, [refreshProjects, loadHotspots, loadFeeds]);

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

  const onAddFeed = async (url: string): Promise<void> => {
    if (feedsBusy) return;
    setFeedsBusy(true);
    try {
      setFeeds(await addFeed(url));
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setFeedsBusy(false);
    }
  };

  const onRemoveFeed = async (url: string): Promise<void> => {
    if (feedsBusy) return;
    setFeedsBusy(true);
    try {
      setFeeds(await removeFeed(url));
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setFeedsBusy(false);
    }
  };

  // Write INTO the open corpus project: stream a draft, then commit it (corpus → draft) and reopen
  // the now-drafted project (→ article view). Materials-first: gather, then write.
  const writeIntoCorpus = async (): Promise<void> => {
    const t = topic.trim();
    if (!selected || !t || running) return;
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
              if (ev.projectId) void openProjectById(ev.projectId); // reopens as a draft → article view
              else void refreshProjects();
            } else if (ev.type === 'error') {
              setPhase('error');
              setStatus(ev.message);
            }
          },
        },
        controller.signal,
        undefined,
        selected.id, // commit INTO this corpus project (corpus → draft)
      );
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        setPhase('error');
        setStatus(err instanceof Error ? err.message : String(err));
      }
    }
  };

  // New piece — it starts as a corpus (gather material first), then open it.
  const createNewCorpus = async (): Promise<void> => {
    try {
      const project = await createCorpusProject();
      setProjects(await listProjects());
      await openProject(project);
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  // Ensure there is an open project to ingest into; create a corpus on the fly if none.
  const ensureCorpus = async (): Promise<string | undefined> => {
    if (selected) return selected.id;
    try {
      const project = await createCorpusProject();
      setProjects(await listProjects());
      await openProject(project);
      return project.id;
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  };

  // Material ingest — add to the open project's corpus, then reconcile the card list.
  const ingest = async (add: (projectId: string) => Promise<unknown>): Promise<void> => {
    const projectId = await ensureCorpus();
    if (!projectId) return;
    setCorpusBusy(true);
    try {
      await add(projectId);
      setCards(await listMaterials(projectId));
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setCorpusBusy(false);
    }
  };

  const onAddUrl = (url: string): void => void ingest((id) => addLinkCard(id, { url }));
  const onAddText = (body: string, kind: 'text' | 'md' | 'code'): void =>
    void ingest((id) => (kind === 'code' ? addCodeCard(id, { snippet: body }) : addTextCard(id, { kind, body })));
  const onAddImageFile = (file: File): void => void ingest((id) => addImageCard(id, file));
  const onAddHotspot = (h: Hotspot): void => void ingest((id) => addHotspotCard(id, h.id));
  const onRemoveCard = (cardId: string): void => {
    if (!selected) return;
    const projectId = selected.id;
    setCards((cs) => cs.filter((c) => c.id !== cardId)); // optimistic
    void removeCard(projectId, cardId).catch(() => void loadCorpus(projectId));
  };

  const onDismissHotspot = async (h: Hotspot): Promise<void> => {
    setHotspots((list) => list.filter((x) => x.id !== h.id)); // optimistic
    try {
      await dismissHotspot(h.id);
    } catch {
      void loadHotspots(); // roll back to the server's truth on failure
    }
  };

  const doDeleteProject = async (project: Project): Promise<void> => {
    if (!window.confirm(`确定删除「${project.title}」？此操作不可撤销。`)) return;
    try {
      await deleteProject(project.id);
      if (selected?.id === project.id) newWrite(); // clear the open pane if it was this project
      await refreshProjects();
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : String(err));
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
    setPanelMode('menu');
    setInstruction('');
    setRewriteError(undefined);
    setTitleEditing(false);
  };

  const loadCorpus = async (projectId: string): Promise<void> => {
    try {
      setCards(await listMaterials(projectId));
    } catch {
      setCards([]); // best-effort
    }
  };

  const openProject = async (project: Project): Promise<void> => {
    setSelected(project);
    setSelectedHtml(null);
    setDraft('');
    setStatus('');
    setPhase('idle');
    clearEdit();
    void loadCorpus(project.id);
    if (project.stage === 'corpus') return; // a corpus project has no article yet
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
        onNew={() => void createNewCorpus()}
        onDelete={(p) => void doDeleteProject(p)}
      />

      <div style={styles.main}>
        {!selected ? (
          <div style={styles.landing}>
            <p style={styles.landingText}>点「＋ 新建」开一篇 —— 先攒素材（拖 / 贴，或从右侧热点「选中加入」），再写作。</p>
            <button style={styles.btn} onClick={() => void createNewCorpus()}>
              ＋ 新建
            </button>
          </div>
        ) : selected.stage === 'corpus' ? (
          <div>
            <header style={styles.viewHeader}>
              <h2 style={styles.viewTitle}>{selected.title}</h2>
              <div style={styles.viewActions}>
                <button
                  style={{ ...styles.btn, ...styles.ghostBtn, ...styles.dangerBtn }}
                  onClick={() => void doDeleteProject(selected)}
                >
                  删除
                </button>
                <button style={styles.btn} onClick={() => void createNewCorpus()}>
                  ＋ 新建
                </button>
              </div>
            </header>
            <p style={styles.hint}>
              攒素材中：右侧拖 / 贴 链接·文本·代码·图片，或从热点「选中加入」。攒够了就基于素材写作（下一步：大纲 W3）。
            </p>
            <div style={styles.inputRow}>
              <input
                style={styles.input}
                value={topic}
                placeholder="给这篇定个主题 / 角度，例如：远程办公正在重塑城市格局"
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void writeIntoCorpus();
                }}
                disabled={running}
              />
              {running ? (
                <button style={{ ...styles.btn, ...styles.stopBtn }} onClick={stop}>
                  停止
                </button>
              ) : (
                <button style={styles.btn} onClick={() => void writeIntoCorpus()} disabled={!topic.trim()}>
                  基于资料写作
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
          </div>
        ) : (
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
                <button
                  style={{ ...styles.btn, ...styles.ghostBtn, ...styles.dangerBtn }}
                  onClick={() => void doDeleteProject(selected)}
                >
                  删除
                </button>
                <button style={styles.btn} onClick={() => void createNewCorpus()}>
                  ＋ 新建
                </button>
              </div>
            </header>
            {selected.source && <ProvenanceLine source={selected.source} />}
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
                  key={selection.blockId}
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
        )}
      </div>

      <CorpusSidebar
        projectId={selected?.id ?? null}
        cards={cards}
        busy={corpusBusy}
        onUrl={onAddUrl}
        onText={onAddText}
        onImage={onAddImageFile}
        onRemove={onRemoveCard}
      >
        <HotspotSidebar
          hotspots={hotspots}
          refreshing={refreshing}
          onSelect={onAddHotspot}
          onRefresh={() => void doRefreshHotspots()}
          onDismiss={(h) => void onDismissHotspot(h)}
        >
          <FeedManager
            feeds={feeds}
            busy={feedsBusy}
            onAdd={(url) => void onAddFeed(url)}
            onRemove={(url) => void onRemoveFeed(url)}
          />
        </HotspotSidebar>
      </CorpusSidebar>
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
  landing: { display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start', padding: '32px 0' },
  landingText: { margin: 0, fontSize: 14, color: '#666', lineHeight: 1.7 },
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
  dangerBtn: { color: '#c0392b', border: '1px solid #e6b0aa' },
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
