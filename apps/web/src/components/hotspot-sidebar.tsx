'use client';

import { useMemo } from 'react';
import type { Hotspot } from '@app/contracts';
import { formatRelative } from '../lib/format/relative-time';

interface HotspotSidebarProps {
  hotspots: Hotspot[];
  refreshing: boolean;
  onSelect: (hotspot: Hotspot) => void;
  onRefresh: () => void;
}

export function HotspotSidebar({ hotspots, refreshing, onSelect, onRefresh }: HotspotSidebarProps) {
  // Single now per render keeps the relative-time labels stable within a paint.
  const now = useMemo(() => Date.now(), [hotspots]);
  return (
    <aside style={styles.aside}>
      <div style={styles.header}>
        <h2 style={styles.heading}>热点</h2>
        <button style={styles.refreshBtn} onClick={onRefresh} disabled={refreshing}>
          {refreshing ? '刷新中…' : '↻ 刷新'}
        </button>
      </div>
      {hotspots.length === 0 ? (
        <p style={styles.empty}>点击「刷新」拉取最新热点，选中即可开始写作。</p>
      ) : (
        <ul style={styles.list}>
          {hotspots.map((h) => (
            <li key={h.id}>
              <button style={styles.item} onClick={() => onSelect(h)} title={h.title}>
                <span style={styles.title}>{h.title}</span>
                <span style={styles.meta}>
                  <span style={{ ...styles.badge, ...(h.sourceType === 'hn' ? styles.badgeHn : styles.badgeRss) }}>
                    {h.sourceType === 'hn' ? 'HN' : 'RSS'}
                  </span>
                  {h.sourceType === 'hn' && (
                    <span style={styles.stats}>
                      ▲{h.points ?? 0} · 💬{h.commentCount ?? 0}
                    </span>
                  )}
                  <time style={styles.time}>{formatRelative(h.publishedAt, now)}</time>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  aside: { width: 260, flexShrink: 0, borderLeft: '1px solid #ececec', paddingLeft: 16 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  heading: { margin: 0, fontSize: 12, letterSpacing: 1, color: '#999', textTransform: 'uppercase' },
  refreshBtn: {
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 600,
    color: '#111',
    background: '#fff',
    border: '1px solid #d0d0d0',
    borderRadius: 6,
    cursor: 'pointer',
  },
  empty: { fontSize: 13, color: '#999', lineHeight: 1.6, marginTop: 12 },
  list: { listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  item: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    width: '100%',
    padding: '9px 10px',
    textAlign: 'left',
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 8,
    cursor: 'pointer',
  },
  title: {
    fontSize: 13.5,
    lineHeight: 1.35,
    color: '#1a1a1a',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  meta: { display: 'flex', alignItems: 'center', gap: 8 },
  badge: { fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, letterSpacing: 0.5 },
  badgeHn: { color: '#fff', background: '#ff6600' },
  badgeRss: { color: '#fff', background: '#0a7d36' },
  stats: { fontSize: 11, color: '#888' },
  time: { fontSize: 11, color: '#aaa', marginLeft: 'auto' },
};
