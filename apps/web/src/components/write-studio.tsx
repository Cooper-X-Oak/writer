'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, Hotspot, MaterialCard } from '@app/contracts';
import { streamWrite } from '../lib/api/write';
import {
  listMaterials,
  addLinkCard,
  addTextCard,
  addCodeCard,
  addImageCard,
  addHotspotCard,
  removeCard,
  runInquiry,
} from '../lib/api/corpus';
import { openCase } from '../lib/api/cases';
import { CorpusSidebar } from './corpus-sidebar';
import { OpenCaseDialog } from './open-case-dialog';
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
import { rewrite } from '../lib/api/rewrite';
import { useHotspots } from '../hooks/useHotspots';
import { useFeeds } from '../hooks/useFeeds';
import { useInbox } from '../hooks/useInbox';
import { projectImageBase, materialImageBase, inboxImageBase } from '../lib/api/base';
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
  const [cards, setCards] = useState<MaterialCard[]>([]);
  const [corpusBusy, setCorpusBusy] = useState(false);
  const [useAgentInquiry, setUseAgentInquiry] = useState(false);
  const [inquiringId, setInquiringId] = useState<string | null>(null);
  const [caseDialogOpen, setCaseDialogOpen] = useState(false);
  const [casePending, setCasePending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Global feeds (hotspot wall + RSS) + the global inbox (planning-desk staging) — hooks (A4/A5).
  const hot = useHotspots();
  const feedsCtl = useFeeds(setStatus);
  const inbox = useInbox(setStatus);

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

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

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
              setTopic('');
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

  // Open a 案卷 (立项) — the explicit, NAMED commit. The phantom is dead: a project dir is created
  // ONLY here (via the title-guarded POST /api/cases), never eagerly on a drop or ＋新建.
  const openNewCase = async (title: string, angle?: string): Promise<void> => {
    setCasePending(true);
    try {
      const project = await openCase(title, angle);
      setProjects(await listProjects());
      setCaseDialogOpen(false);
      await openProject(project);
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setCasePending(false);
    }
  };

  // Material ingest into the OPEN project's corpus. With no open project the drop handlers target the
  // inbox instead (wired in the render) — so dropping material never silently creates a project.
  const ingest = async (add: (projectId: string) => Promise<unknown>): Promise<void> => {
    if (!selected) return;
    const projectId = selected.id;
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

  // W2 询证: gather 补充/对比 evidence for an existing card seed, then reconcile the card list.
  const inquireFor = async (cardId: string): Promise<void> => {
    if (!selected || inquiringId) return;
    const projectId = selected.id;
    setInquiringId(cardId);
    try {
      const r = await runInquiry(projectId, { seedCardId: cardId, useAgent: useAgentInquiry });
      setCards(await listMaterials(projectId));
      const tier = r.usedAgent ? 'agent 核验' : '规则询证';
      setStatus(r.added.length ? `询证：新增 ${String(r.added.length)} 条佐证 / 对比（${tier}）` : '询证：未找到新的佐证');
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setInquiringId(null);
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
    setCards([]);
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
        onNew={() => setCaseDialogOpen(true)}
        onDelete={(p) => void doDeleteProject(p)}
      />

      <div style={styles.main}>
        {!selected ? (
          <div style={styles.landing}>
            <h2 style={styles.viewTitle}>策划台</h2>
            <p style={styles.landingText}>
              先收集，再写作。把 链接 / 文本 / 图片 / 代码 丢进右侧「收件箱」暂存，或从热点「选中加入」 ——
              不立项、不归属任何篇。攒得差不多了，「＋ 开案卷」把素材拣进一篇案卷，开始攒料 → 询证 → 写作。
            </p>
            <button style={styles.btn} onClick={() => setCaseDialogOpen(true)}>
              ＋ 开案卷
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
                <button style={styles.btn} onClick={() => setCaseDialogOpen(true)}>
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
                <button style={styles.btn} onClick={() => setCaseDialogOpen(true)}>
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

      {selected ? (
        <CorpusSidebar
          variant="corpus"
          cards={cards}
          imageBase={materialImageBase(selected.id)}
          busy={corpusBusy}
          onUrl={onAddUrl}
          onText={onAddText}
          onImage={onAddImageFile}
          onRemove={onRemoveCard}
          onInquire={(id) => void inquireFor(id)}
          inquiringId={inquiringId}
          useAgent={useAgentInquiry}
          onToggleAgent={setUseAgentInquiry}
        >
          <HotspotSidebar
            hotspots={hot.hotspots}
            refreshing={hot.refreshing}
            onSelect={onAddHotspot}
            onRefresh={() => void hot.refresh()}
            onDismiss={(h) => void hot.dismiss(h)}
          >
            <FeedManager feeds={feedsCtl.feeds} busy={feedsCtl.busy} onAdd={(url) => void feedsCtl.add(url)} onRemove={(url) => void feedsCtl.remove(url)} />
          </HotspotSidebar>
        </CorpusSidebar>
      ) : (
        <CorpusSidebar
          variant="inbox"
          cards={inbox.items}
          imageBase={inboxImageBase()}
          busy={inbox.busy}
          onUrl={inbox.addUrl}
          onText={inbox.addText}
          onImage={inbox.addImage}
          onRemove={inbox.remove}
        >
          <HotspotSidebar
            hotspots={hot.hotspots}
            refreshing={hot.refreshing}
            onSelect={(h) => void inbox.addHotspot(h.id)}
            onRefresh={() => void hot.refresh()}
            onDismiss={(h) => void hot.dismiss(h)}
          >
            <FeedManager feeds={feedsCtl.feeds} busy={feedsCtl.busy} onAdd={(url) => void feedsCtl.add(url)} onRemove={(url) => void feedsCtl.remove(url)} />
          </HotspotSidebar>
        </CorpusSidebar>
      )}

      <OpenCaseDialog
        open={caseDialogOpen}
        busy={casePending}
        onConfirm={(title, angle) => void openNewCase(title, angle)}
        onCancel={() => setCaseDialogOpen(false)}
      />
    </section>
  );
}

/** Make a project title safe as a download filename (strip path/illegal chars; fall back). */
function safeFilename(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned || 'article';
}

const styles: Record<string, React.CSSProperties> = {
  layout: { marginTop: 24, display: 'flex', gap: 22, alignItems: 'flex-start' },
  main: { flex: 1, minWidth: 0, maxWidth: 'var(--measure)' },
  landing: { display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start', padding: '40px 0' },
  landingText: { margin: 0, fontFamily: 'var(--font-read)', fontSize: 15, color: 'var(--ink-muted)', lineHeight: 1.75 },
  inputRow: { display: 'flex', gap: 8 },
  input: {
    flex: 1,
    padding: '10px 12px',
    fontFamily: 'var(--font-chrome)',
    fontSize: 15,
    color: 'var(--ink)',
    background: 'var(--paper)',
    border: '1px solid var(--deckle)',
    borderRadius: 'var(--radius)',
    outline: 'none',
  },
  btn: {
    padding: '10px 18px',
    fontFamily: 'var(--font-chrome)',
    fontSize: 14.5,
    fontWeight: 600,
    color: 'var(--paper)',
    background: 'var(--ink)',
    border: '1px solid var(--ink)',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--lift-sm)',
    cursor: 'pointer',
  },
  stopBtn: { background: 'var(--string)', border: '1px solid var(--string)' },
  viewHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 },
  viewActions: { display: 'flex', gap: 8 },
  ghostBtn: { color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--deckle)', boxShadow: 'none' },
  dangerBtn: { color: 'var(--string)', background: 'var(--paper)', border: '1px solid oklch(54% 0.2 27 / 0.4)' },
  editOn: { color: 'var(--paper)', background: 'var(--edge-support)', border: '1px solid var(--edge-support)' },
  hint: { margin: '0 0 12px', fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.6 },
  viewTitle: { margin: 0, fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--ink)', cursor: 'text', letterSpacing: '-0.01em' },
  titleInput: {
    margin: 0,
    flex: 1,
    minWidth: 0,
    marginRight: 12,
    padding: '4px 8px',
    fontFamily: 'var(--font-display)',
    fontSize: 24,
    fontWeight: 600,
    color: 'var(--ink)',
    background: 'var(--paper)',
    border: '1px solid var(--edge-support)',
    borderRadius: 6,
    outline: 'none',
  },
  errorLine: { marginTop: 8, fontSize: 13, color: 'var(--string)' },
  status: { marginTop: 12, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: 8 },
  pulse: {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: 'var(--edge-support)',
  },
  draft: {
    marginTop: 16,
    padding: '24px 28px',
    fontFamily: 'var(--font-read)',
    background: 'var(--paper)',
    border: '1px solid var(--deckle)',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--lift)',
    lineHeight: 1.85,
    fontSize: 17,
    color: 'var(--ink)',
    whiteSpace: 'pre-wrap',
  },
  caret: {
    display: 'inline-block',
    width: 7,
    height: 18,
    marginLeft: 2,
    background: 'var(--string)',
    verticalAlign: 'text-bottom',
  },
};
