'use client';

import type { MaterialCard } from '@app/contracts';
import { MaterialCardView } from './material-card';
import { CorpusDropZone } from './corpus-drop-zone';

interface CorpusSidebarProps {
  /** 'corpus' = a project's 资料区 (with 询证); 'inbox' = the global 收件箱 staging (no project). */
  variant?: 'corpus' | 'inbox';
  cards: MaterialCard[];
  /** Base URL for card image bytes (materials-images for a project, inbox-images for the inbox). */
  imageBase: string;
  busy: boolean;
  onUrl: (url: string) => void;
  onText: (body: string, kind: 'text' | 'md' | 'code') => void;
  onImage: (file: File) => void;
  onRemove: (id: string) => void;
  /** W2 询证 (corpus only): gather evidence for a card seed + the id currently being gathered. */
  onInquire?: (id: string) => void;
  inquiringId?: string | null;
  useAgent?: boolean;
  onToggleAgent?: (on: boolean) => void;
  /** The hotspot feeder (HotspotSidebar) — hotspots flow INTO this surface. */
  children?: React.ReactNode;
}

/** Persistent right rail. Renders either a project's 资料区 (corpus, with 询证) or the global 收件箱
 *  (inbox staging, no project) + the hotspot feeder below it. */
export function CorpusSidebar({
  variant = 'corpus', cards, imageBase, busy, onUrl, onText, onImage, onRemove, onInquire, inquiringId, useAgent, onToggleAgent, children,
}: CorpusSidebarProps) {
  const isInbox = variant === 'inbox';
  return (
    <aside className="cork-board grain" style={styles.aside}>
      <h2 style={styles.heading}>{isInbox ? '收件箱 · 暂存' : '资料区 · 案板'}</h2>
      <CorpusDropZone busy={busy} onUrl={onUrl} onText={onText} onImage={onImage} />
      {!isInbox && onToggleAgent && (
        <label style={styles.agentToggle} title="用本机 agent 给佐证/对比做语义核验；未就绪则自动退回规则询证">
          <input type="checkbox" checked={useAgent ?? false} onChange={(e) => onToggleAgent(e.target.checked)} />
          询证时用 agent 深度核验
        </label>
      )}
      {cards.length === 0 ? (
        <p style={styles.empty}>
          {isInbox
            ? '把 链接 / 文本 / 代码 / 图片 丢进收件箱，或从下方热点「选中加入」。立项后可拣进案卷。'
            : '拖 / 贴 链接、文本、代码、图片到上面，或从下方热点「选中加入」。攒到一张后可「找佐证 / 对比」。'}
        </p>
      ) : (
        <ul style={styles.list}>
          {cards.map((c) => (
            <MaterialCardView
              key={c.id}
              card={c}
              imageBase={imageBase}
              onRemove={onRemove}
              onInquire={isInbox ? undefined : onInquire}
              inquiring={inquiringId === c.id}
            />
          ))}
        </ul>
      )}
      <div style={styles.feeder}>{children}</div>
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  aside: { width: 296, flexShrink: 0, padding: '14px 14px 18px', marginLeft: -6, display: 'flex', flexDirection: 'column', gap: 10 },
  heading: { position: 'relative', zIndex: 1, margin: 0, fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, letterSpacing: '0.01em', color: 'var(--ink)' },
  agentToggle: { position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-muted)', cursor: 'pointer' },
  empty: { position: 'relative', zIndex: 1, fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.6, margin: 0 },
  list: { position: 'relative', zIndex: 1, listStyle: 'none', margin: '2px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 13 },
  feeder: { position: 'relative', zIndex: 1, borderTop: '1px solid var(--board-cork-2)', paddingTop: 10, marginTop: 4 },
};
