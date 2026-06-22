'use client';

import type { MaterialCard } from '@app/contracts';
import { MaterialCardView } from './material-card';
import { CorpusDropZone } from './corpus-drop-zone';

interface CorpusSidebarProps {
  /** The open project (corpus or draft) whose materials these are; null if none open. */
  projectId: string | null;
  cards: MaterialCard[];
  busy: boolean;
  onUrl: (url: string) => void;
  onText: (body: string, kind: 'text' | 'md' | 'code') => void;
  onImage: (file: File) => void;
  onRemove: (id: string) => void;
  /** The hotspot feeder (HotspotSidebar) — hotspots flow INTO the corpus. */
  children?: React.ReactNode;
}

/** Persistent right rail. The 资料区 of the open project + the hotspot feeder below it. */
export function CorpusSidebar({ projectId, cards, busy, onUrl, onText, onImage, onRemove, children }: CorpusSidebarProps) {
  return (
    <aside style={styles.aside}>
      <h2 style={styles.heading}>资料区</h2>
      {projectId ? (
        <>
          <CorpusDropZone busy={busy} onUrl={onUrl} onText={onText} onImage={onImage} />
          {cards.length === 0 ? (
            <p style={styles.empty}>拖 / 贴 链接、文本、代码、图片到上面，或从下方热点「选中加入」。</p>
          ) : (
            <ul style={styles.list}>
              {cards.map((c) => (
                <MaterialCardView key={c.id} card={c} projectId={projectId} onRemove={onRemove} />
              ))}
            </ul>
          )}
        </>
      ) : (
        <p style={styles.empty}>点「＋ 新建」开一篇，先攒素材再写作。</p>
      )}
      <div style={styles.feeder}>{children}</div>
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  aside: { width: 280, flexShrink: 0, borderLeft: '1px solid #ececec', paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 10 },
  heading: { margin: 0, fontSize: 12, letterSpacing: 1, color: '#999', textTransform: 'uppercase' },
  empty: { fontSize: 13, color: '#999', lineHeight: 1.6, margin: 0 },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  feeder: { borderTop: '1px solid #f0f0f0', paddingTop: 10, marginTop: 4 },
};
