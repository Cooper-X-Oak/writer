'use client';

import { useState } from 'react';

interface BlockToolbarProps {
  onRewrite: () => void;
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onInsertAfter: () => void;
  onDelete: () => void;
  onCancel: () => void;
  busy: boolean;
}

// All structural intent lives here in the React parent — the sandboxed iframe only ever reports a
// selected block; it never gets edit power. Delete is two-step (click → 确认删除?) to avoid accidents.
export function BlockToolbar({ onRewrite, onEdit, onMoveUp, onMoveDown, onInsertAfter, onDelete, onCancel, busy }: BlockToolbarProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div style={styles.bar}>
      <span style={styles.label}>这一段</span>
      <button style={styles.btn} onClick={onRewrite} disabled={busy}>AI 改写</button>
      <button style={styles.btn} onClick={onEdit} disabled={busy}>手动编辑</button>
      <button style={styles.btn} onClick={onMoveUp} disabled={busy} title="上移">↑</button>
      <button style={styles.btn} onClick={onMoveDown} disabled={busy} title="下移">↓</button>
      <button style={styles.btn} onClick={onInsertAfter} disabled={busy}>＋ 在下方插入</button>
      {confirmDelete ? (
        <button style={{ ...styles.btn, ...styles.danger }} onClick={onDelete} disabled={busy}>
          确认删除？
        </button>
      ) : (
        <button style={{ ...styles.btn, ...styles.dangerGhost }} onClick={() => setConfirmDelete(true)} disabled={busy}>
          删除
        </button>
      )}
      <button style={styles.close} onClick={onCancel} aria-label="取消">✕</button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    marginTop: 16,
    padding: '10px 12px',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    border: '1px solid #ececec',
    borderRadius: 12,
    background: '#fafafa',
  },
  label: { fontSize: 13, fontWeight: 600, color: '#333', marginRight: 4 },
  btn: { padding: '5px 10px', fontSize: 13, color: '#111', background: '#fff', border: '1px solid #d6d6d6', borderRadius: 8, cursor: 'pointer' },
  dangerGhost: { color: '#c0392b', borderColor: '#e6b0aa' },
  danger: { color: '#fff', background: '#c0392b', border: '1px solid #c0392b' },
  close: { marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: '#999', fontSize: 14 },
};
