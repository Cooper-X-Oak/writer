'use client';

interface RewritePanelProps {
  selectedText: string;
  instruction: string;
  rewriting: boolean;
  error?: string;
  onInstructionChange: (v: string) => void;
  onRewrite: () => void;
  onCancel: () => void;
}

const PRESETS = ['更犀利', '更简洁', '更口语', '加个具体例子'];

export function RewritePanel({
  selectedText,
  instruction,
  rewriting,
  error,
  onInstructionChange,
  onRewrite,
  onCancel,
}: RewritePanelProps) {
  return (
    <div style={styles.panel}>
      <div style={styles.head}>
        <span style={styles.label}>改写这一段</span>
        <button style={styles.close} onClick={onCancel} aria-label="取消">
          ✕
        </button>
      </div>
      <blockquote style={styles.quote}>{selectedText}</blockquote>
      <div style={styles.presets}>
        {PRESETS.map((p) => (
          <button key={p} style={styles.preset} onClick={() => onInstructionChange(p)} disabled={rewriting}>
            {p}
          </button>
        ))}
      </div>
      <div style={styles.row}>
        <input
          style={styles.input}
          value={instruction}
          placeholder="怎么改？例如：删掉废话，留最锋利的一句"
          onChange={(e) => onInstructionChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !rewriting) onRewrite();
          }}
          disabled={rewriting}
        />
        <button style={styles.go} onClick={onRewrite} disabled={rewriting}>
          {rewriting ? '改写中…' : '改写'}
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
  quote: {
    margin: '0 0 12px',
    padding: '8px 12px',
    borderLeft: '3px solid #2ecc71',
    background: '#fff',
    color: '#555',
    fontSize: 14,
    lineHeight: 1.7,
    maxHeight: 120,
    overflow: 'auto',
  },
  presets: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  preset: {
    padding: '4px 10px',
    fontSize: 12,
    color: '#333',
    background: '#fff',
    border: '1px solid #ddd',
    borderRadius: 999,
    cursor: 'pointer',
  },
  row: { display: 'flex', gap: 8 },
  input: { flex: 1, padding: '8px 12px', fontSize: 14, border: '1px solid #d0d0d0', borderRadius: 8, outline: 'none' },
  go: {
    padding: '8px 18px',
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    background: '#111',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  error: { marginTop: 8, marginBottom: 0, fontSize: 13, color: '#c0392b' },
};
