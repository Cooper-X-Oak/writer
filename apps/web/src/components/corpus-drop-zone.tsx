'use client';

import { useRef, useState } from 'react';

interface CorpusDropZoneProps {
  busy: boolean;
  onUrl: (url: string) => void;
  onText: (body: string, kind: 'text' | 'md' | 'code') => void;
  onImage: (file: File) => void;
}

const CODE_EXT = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'rb', 'php', 'sh', 'sql', 'json', 'yaml', 'yml', 'css', 'html']);

function looksFetchable(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s.trim());
}

/** A single multi-modal ingest target: drag-drop, paste, a file picker, and a URL/text box. The
 *  daemon is the validation authority — this only routes the input to the right endpoint. */
export function CorpusDropZone({ busy, onUrl, onText, onImage }: CorpusDropZoneProps) {
  const [draft, setDraft] = useState('');
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const routeFile = (file: File): void => {
    if (file.type.startsWith('image/')) {
      onImage(file);
      return;
    }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    void file.text().then((body) => {
      if (ext === 'md' || ext === 'markdown') onText(body, 'md');
      else if (CODE_EXT.has(ext)) onText(body, 'code');
      else onText(body, 'text');
    });
  };

  const handleFiles = (files: FileList | null): void => {
    if (!files) return;
    Array.from(files).forEach(routeFile);
  };

  const submit = (): void => {
    const v = draft.trim();
    if (!v) return;
    if (looksFetchable(v)) onUrl(v);
    else onText(v, 'text');
    setDraft('');
  };

  return (
    <div
      style={{ ...styles.zone, ...(over ? styles.zoneOver : null) }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) { handleFiles(e.dataTransfer.files); return; }
        const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (url && looksFetchable(url)) onUrl(url.trim());
        else if (url) onText(url, 'text');
      }}
      onPaste={(e) => {
        if (e.clipboardData.files.length) { e.preventDefault(); handleFiles(e.clipboardData.files); }
      }}
    >
      <textarea
        style={styles.input}
        value={draft}
        disabled={busy}
        placeholder="贴链接 / 文本 / 代码，或把文件拖到这里"
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
      />
      <div style={styles.actions}>
        <button style={styles.add} disabled={busy || !draft.trim()} onClick={submit}>添加</button>
        <button style={styles.file} disabled={busy} onClick={() => fileRef.current?.click()}>＋ 文件</button>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  zone: { display: 'flex', flexDirection: 'column', gap: 6, padding: 8, border: '1px dashed #d0d0d0', borderRadius: 10, background: '#fafafa', transition: 'background 150ms, border-color 150ms' },
  zoneOver: { borderColor: '#2563eb', background: '#eef4ff' },
  input: { width: '100%', resize: 'vertical', fontSize: 13, padding: '6px 8px', border: '1px solid #e0e0e0', borderRadius: 6, fontFamily: 'inherit', boxSizing: 'border-box' },
  actions: { display: 'flex', gap: 6 },
  add: { padding: '4px 12px', fontSize: 12.5, fontWeight: 600, color: '#fff', background: '#111', border: 'none', borderRadius: 6, cursor: 'pointer' },
  file: { padding: '4px 10px', fontSize: 12.5, color: '#333', background: '#fff', border: '1px solid #d6d6d6', borderRadius: 6, cursor: 'pointer' },
};
