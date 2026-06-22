'use client';

import type { MaterialCard } from '@app/contracts';
import { hostnameOf } from '../lib/format/provenance';
import { materialImageBase } from '../lib/api/base';

interface MaterialCardViewProps {
  card: MaterialCard;
  projectId: string;
  onRemove: (id: string) => void;
}

const KIND_LABEL: Record<MaterialCard['kind'], string> = { link: '链接', image: '图片', md: 'MD', text: '文本', code: '代码' };

function preview(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** One material card in the 资料区 rail. kind-switches the body; user content is rendered as React
 *  text (auto-escaped) — never dangerouslySetInnerHTML. */
export function MaterialCardView({ card, projectId, onRemove }: MaterialCardViewProps) {
  return (
    <li style={styles.row}>
      <div style={styles.card}>
        <div style={styles.meta}>
          <span style={styles.kind}>{KIND_LABEL[card.kind]}</span>
          <span style={styles.chip}>{card.origin === 'auto' ? '询证' : '手工'}</span>
          <span style={styles.klass}>{card.klass}</span>
        </div>
        {card.kind === 'link' && (
          <a style={styles.link} href={card.content.url} target="_blank" rel="noopener noreferrer" title={card.content.url}>
            {card.content.title || hostnameOf(card.content.url)} ↗
          </a>
        )}
        {card.kind === 'link' && card.content.excerpt && <p style={styles.excerpt}>{preview(card.content.excerpt)}</p>}
        {card.kind === 'image' && (
          <img style={styles.img} src={`${materialImageBase(projectId)}${card.content.filename}`} alt={card.content.alt} />
        )}
        {(card.kind === 'text' || card.kind === 'md') && <p style={styles.text}>{preview(card.content.body)}</p>}
        {card.kind === 'code' && <pre style={styles.code}>{preview(card.content.snippet, 300)}</pre>}
      </div>
      <button style={styles.remove} aria-label={`移除这张${KIND_LABEL[card.kind]}卡`} title="移除" onClick={() => onRemove(card.id)}>
        ✕
      </button>
    </li>
  );
}

const styles: Record<string, React.CSSProperties> = {
  row: { display: 'flex', alignItems: 'flex-start', gap: 2 },
  card: { flex: 1, minWidth: 0, padding: '8px 10px', border: '1px solid #ececec', borderRadius: 8, background: '#fff', display: 'flex', flexDirection: 'column', gap: 4 },
  meta: { display: 'flex', alignItems: 'center', gap: 6 },
  kind: { fontSize: 10, fontWeight: 700, color: '#fff', background: '#555', padding: '1px 5px', borderRadius: 4 },
  chip: { fontSize: 10, color: '#888', border: '1px solid #e0e0e0', padding: '0 5px', borderRadius: 4 },
  klass: { fontSize: 10, color: '#aaa' },
  link: { fontSize: 13, color: '#2563eb', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  excerpt: { fontSize: 12, color: '#777', margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  text: { fontSize: 12.5, color: '#333', margin: 0, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  code: { fontSize: 11, color: '#333', background: '#f6f6f6', borderRadius: 6, padding: 8, margin: 0, maxHeight: 96, overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  img: { maxWidth: '100%', borderRadius: 6, display: 'block' },
  remove: { flexShrink: 0, border: 'none', background: 'transparent', color: '#ccc', cursor: 'pointer', fontSize: 12, padding: '8px 6px 0', lineHeight: 1 },
};
