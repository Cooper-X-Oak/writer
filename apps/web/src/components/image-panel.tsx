'use client';

import { useEffect, useState } from 'react';
import { getBridge } from '../lib/electron';

interface ImagePanelProps {
  projectId: string;
  title: string;
  onGenerated: (html: string) => void;
}

type Status = { configured: boolean; baseURL?: string; model?: string };

export function ImagePanel({ projectId, title, onGenerated }: ImagePanelProps) {
  const bridge = getBridge();
  const [status, setStatus] = useState<Status | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!bridge) return;
    void bridge.imageConfigStatus().then((s) => {
      setStatus(s);
      if (s.baseURL) setBaseURL(s.baseURL);
      if (s.model) setModel(s.model);
      setShowSettings(!s.configured);
    });
  }, [bridge]);

  if (!bridge) {
    return <p style={styles.hint}>插图功能需在桌面应用内使用（浏览器里没有安全的密钥通道）。</p>;
  }

  const save = async (): Promise<void> => {
    setError(undefined);
    try {
      await bridge.saveImageConfig({ baseURL: baseURL.trim(), model: model.trim(), apiKey: apiKey.trim() });
      setApiKey(''); // never keep the key in component state after saving
      setStatus(await bridge.imageConfigStatus());
      setShowSettings(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const generate = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const p = prompt.trim() || `为这篇关于「${title}」的文章配一张契合主题的插图`;
      const result = await bridge.generateImage({ projectId, prompt: p });
      onGenerated(result.html);
      setPrompt('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.panel}>
      <div style={styles.head}>
        <span style={styles.label}>插图</span>
        <button style={styles.link} onClick={() => setShowSettings((v) => !v)}>
          {status?.configured ? `已配置（${status.model ?? ''}）· 设置` : '配置图像服务'}
        </button>
      </div>

      {showSettings && (
        <div style={styles.settings}>
          <input style={styles.input} value={baseURL} placeholder="中转站 Base URL，如 https://xxx/v1 的上级 https://xxx" onChange={(e) => setBaseURL(e.target.value)} />
          <input style={styles.input} value={model} placeholder="模型名，如 dall-e-3 / gpt-image-1" onChange={(e) => setModel(e.target.value)} />
          <input style={styles.input} type="password" value={apiKey} placeholder="API Key（仅写入，加密存储，不回显）" onChange={(e) => setApiKey(e.target.value)} />
          <button style={styles.save} onClick={() => void save()} disabled={!baseURL.trim() || !model.trim() || !apiKey.trim()}>
            保存
          </button>
        </div>
      )}

      {status?.configured && !showSettings && (
        <div style={styles.row}>
          <input
            style={styles.input}
            value={prompt}
            placeholder={`配图描述（留空＝按「${title}」自动）`}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void generate();
            }}
            disabled={busy}
          />
          <button style={styles.go} onClick={() => void generate()} disabled={busy}>
            {busy ? '生成中…' : '配图'}
          </button>
        </div>
      )}

      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { marginTop: 16, padding: 16, border: '1px solid #ececec', borderRadius: 12, background: '#fafafa' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  label: { fontSize: 13, fontWeight: 600, color: '#333' },
  link: { border: 'none', background: 'transparent', color: '#2563eb', cursor: 'pointer', fontSize: 13 },
  hint: { marginTop: 16, fontSize: 13, color: '#999' },
  settings: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 },
  row: { display: 'flex', gap: 8 },
  input: { flex: 1, padding: '8px 12px', fontSize: 14, border: '1px solid #d0d0d0', borderRadius: 8, outline: 'none' },
  save: {
    padding: '8px 18px',
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    background: '#2563eb',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
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
