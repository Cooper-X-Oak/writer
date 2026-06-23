'use client';

import { useState } from 'react';

interface OpenCaseDialogProps {
  open: boolean;
  busy?: boolean;
  onConfirm: (title: string, angle?: string) => void;
  onCancel: () => void;
}

/** 立项 dialog — the explicit, named commit that opens a 案卷 (no phantom). A title is required;
 *  an optional 角度 seeds the working direction. Replaces the old eager corpus creation. */
export function OpenCaseDialog({ open, busy, onConfirm, onCancel }: OpenCaseDialogProps) {
  const [title, setTitle] = useState('');
  const [angle, setAngle] = useState('');
  if (!open) return null;

  const submit = (): void => {
    const t = title.trim();
    if (!t || busy) return;
    onConfirm(t, angle.trim() || undefined);
  };

  return (
    <div style={styles.scrim} onClick={onCancel} role="presentation">
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="开新案卷">
        <h2 style={styles.heading}>开一个案卷</h2>
        <p style={styles.sub}>给这篇起个名字（之后可改）。开案卷后就在它的案板上攒资料、询证，再写作。</p>
        <input
          style={styles.input}
          value={title}
          autoFocus
          placeholder="案卷名 / 主题，例如：远程办公正在重塑城市格局"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') onCancel();
          }}
        />
        <input
          style={styles.input}
          value={angle}
          placeholder="角度 / 立意（可选）"
          onChange={(e) => setAngle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') onCancel();
          }}
        />
        <div style={styles.actions}>
          <button style={{ ...styles.btn, ...styles.ghost }} onClick={onCancel}>
            取消
          </button>
          <button style={styles.btn} onClick={submit} disabled={!title.trim() || busy}>
            {busy ? '开案卷中…' : '开案卷'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  scrim: { position: 'fixed', inset: 0, background: 'oklch(24% 0.02 60 / 0.32)', display: 'grid', placeItems: 'center', zIndex: 50 },
  dialog: { width: 'min(92vw, 460px)', background: 'var(--paper)', border: '1px solid var(--deckle)', borderRadius: 'var(--radius)', boxShadow: 'var(--lift)', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 },
  heading: { margin: 0, fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--ink)' },
  sub: { margin: 0, fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.6 },
  input: { padding: '10px 12px', fontFamily: 'var(--font-chrome)', fontSize: 15, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--deckle)', borderRadius: 'var(--radius)', outline: 'none' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  btn: { padding: '9px 18px', fontFamily: 'var(--font-chrome)', fontSize: 14.5, fontWeight: 600, color: 'var(--paper)', background: 'var(--ink)', border: '1px solid var(--ink)', borderRadius: 'var(--radius)', cursor: 'pointer' },
  ghost: { color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--deckle)' },
};
