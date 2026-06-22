'use client';

import { useState } from 'react';

interface EditPanelProps {
  selectedText: string;
  saving: boolean;
  error?: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}

// Manual, no-AI paragraph editor: a textarea seeded with the current text. Save = patchBlock with the
// user's text (Cmd/Ctrl+Enter or the button). Empty text is rejected by the daemon (clear = delete).
export function EditPanel({ selectedText, saving, error, onSave, onCancel }: EditPanelProps) {
  const [text, setText] = useState(selectedText);
  const canSave = text.trim().length > 0 && !saving;
  return (
    <div style={styles.panel}>
      <div style={styles.head}>
        <span style={styles.label}>手动编辑这一段</span>
        <button style={styles.close} onClick={onCancel} aria-label="取消">✕</button>
      </div>
      <textarea
        style={styles.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSave) onSave(text);
        }}
        rows={5}
        autoFocus
        disabled={saving}
      />
      <div style={styles.row}>
        <span style={styles.hint}>⌘/Ctrl + Enter 保存</span>
        <button style={styles.save} onClick={() => onSave(text)} disabled={!canSave}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { marginTop: 16, padding: 16, border: '1px solid #ececec', borderRadius: 12, background: '#fafafa' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  label: { fontSize: 13, fontWeight: 600, color: '#333' },
  close: { border: 'none', background: 'transparent', cursor: 'pointer', color: '#999', fontSize: 14 },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    fontSize: 14,
    lineHeight: 1.7,
    border: '1px solid #d0d0d0',
    borderRadius: 8,
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  hint: { fontSize: 12, color: '#aaa' },
  save: { padding: '8px 18px', fontSize: 14, fontWeight: 600, color: '#fff', background: '#111', border: 'none', borderRadius: 8, cursor: 'pointer' },
  error: { marginTop: 8, marginBottom: 0, fontSize: 13, color: '#c0392b' },
};
