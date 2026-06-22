'use client';

import { useState } from 'react';

interface FeedManagerProps {
  feeds: string[];
  busy: boolean;
  onAdd: (url: string) => void;
  onRemove: (url: string) => void;
}

/** Client-side sanity check only (UX). The daemon's isFetchableUrl is the real boundary. */
function looksFetchable(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Controlled/presentational — the studio owns the feed list + API calls (mirrors HotspotSidebar).
export function FeedManager({ feeds, busy, onAdd, onRemove }: FeedManagerProps) {
  const [draft, setDraft] = useState('');
  const canAdd = looksFetchable(draft.trim()) && !busy;
  const submit = (): void => {
    const url = draft.trim();
    if (!looksFetchable(url) || busy) return;
    onAdd(url);
    setDraft('');
  };
  return (
    <section style={styles.box}>
      <h3 style={styles.heading}>RSS 订阅源</h3>
      <div style={styles.addRow}>
        <input
          style={styles.input}
          type="url"
          value={draft}
          placeholder="https://example.com/feed.xml"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          disabled={busy}
        />
        <button style={styles.addBtn} onClick={submit} disabled={!canAdd}>
          添加
        </button>
      </div>
      {feeds.length === 0 ? (
        <p style={styles.empty}>还没有订阅源。加一个 RSS/Atom 地址，下次刷新就会从这里抓热点。</p>
      ) : (
        <ul style={styles.list}>
          {feeds.map((url) => (
            <li key={url} style={styles.row}>
              <span style={styles.url} title={url}>
                {url}
              </span>
              <button style={styles.remove} onClick={() => onRemove(url)} disabled={busy} aria-label="移除">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <p style={styles.note}>改动会在下次「刷新热点」时生效。</p>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  box: { marginTop: 20, paddingTop: 16, borderTop: '1px solid #ececec' },
  heading: { margin: '0 0 8px', fontSize: 12, letterSpacing: 1, color: '#999', textTransform: 'uppercase' },
  addRow: { display: 'flex', gap: 6 },
  input: { flex: 1, minWidth: 0, padding: '6px 8px', fontSize: 12, border: '1px solid #d0d0d0', borderRadius: 6, outline: 'none' },
  addBtn: { padding: '6px 12px', fontSize: 12, fontWeight: 600, color: '#fff', background: '#111', border: 'none', borderRadius: 6, cursor: 'pointer' },
  empty: { fontSize: 12, color: '#999', lineHeight: 1.6, marginTop: 10 },
  list: { listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  row: { display: 'flex', alignItems: 'center', gap: 6 },
  url: { flex: 1, minWidth: 0, fontSize: 12, color: '#444', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  remove: { border: 'none', background: 'transparent', color: '#bbb', cursor: 'pointer', fontSize: 13, padding: '0 2px' },
  note: { fontSize: 11, color: '#bbb', marginTop: 10 },
};
