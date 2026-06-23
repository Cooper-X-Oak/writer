'use client';

import type { MaterialCard } from '@app/contracts';
import { hostnameOf } from '../lib/format/provenance';
import { materialImageBase } from '../lib/api/base';

interface MaterialCardViewProps {
  card: MaterialCard;
  projectId: string;
  onRemove: (id: string) => void;
  /** Gather 补充/对比 evidence for this card as the seed (W2 询证). Omit to hide the action. */
  onInquire?: (id: string) => void;
  /** True while a 询证 run seeded by this card is in flight. */
  inquiring?: boolean;
}

const KIND_LABEL: Record<MaterialCard['kind'], string> = { link: '链接', image: '图片', md: 'MD', text: '文本', code: '代码' };
const STANCE_LABEL: Record<NonNullable<MaterialCard['stance']>, string> = {
  corroborate: '佐证',
  contradict: '反驳',
  neutral: '相关',
};

function preview(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** One material card in the 资料区 rail. kind-switches the body; user content is rendered as React
 *  text (auto-escaped) — never dangerouslySetInnerHTML. Auto (询证) cards also show a cross-verify
 *  stance, a confidence bar, and their 核验 note. A non-image card can seed a further 询证 run. */
export function MaterialCardView({ card, projectId, onRemove, onInquire, inquiring }: MaterialCardViewProps) {
  const isAuto = card.origin === 'auto';
  const stance = card.stance ? STANCE_LABEL[card.stance] : null;
  const pct = Math.round(Math.min(1, Math.max(0, card.confidence)) * 100);
  return (
    <li style={styles.row}>
      <div style={styles.card}>
        <div style={styles.meta}>
          <span style={styles.kind}>{KIND_LABEL[card.kind]}</span>
          <span style={styles.chip}>{isAuto ? '询证' : '手工'}</span>
          <span style={card.klass === '对比' ? styles.klassContrast : styles.klass}>{card.klass}</span>
          {stance && <span style={card.stance === 'contradict' ? styles.stanceContra : styles.stance}>{stance}</span>}
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
        {isAuto && card.note && <p style={styles.note}>核验：{card.note}</p>}
        {isAuto && (
          <div style={styles.confRow} title={`置信度 ${String(pct)}%`}>
            <span style={styles.confTrack}>
              <span style={{ ...styles.confFill, width: `${String(pct)}%` }} />
            </span>
            <span style={styles.confPct}>{pct}%</span>
          </div>
        )}
        {onInquire && card.kind !== 'image' && (
          <button style={styles.inquire} disabled={inquiring} onClick={() => onInquire(card.id)}>
            {inquiring ? '询证中…' : '找佐证 / 对比'}
          </button>
        )}
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
  klassContrast: { fontSize: 10, fontWeight: 700, color: '#b45309' },
  stance: { fontSize: 10, color: '#16a34a', border: '1px solid #bbf7d0', padding: '0 4px', borderRadius: 4 },
  stanceContra: { fontSize: 10, color: '#dc2626', border: '1px solid #fecaca', padding: '0 4px', borderRadius: 4 },
  note: { fontSize: 11.5, color: '#7c6f00', margin: 0, fontStyle: 'italic' },
  confRow: { display: 'flex', alignItems: 'center', gap: 6 },
  confTrack: { flex: 1, height: 4, background: '#eee', borderRadius: 2, overflow: 'hidden' },
  confFill: { display: 'block', height: '100%', background: '#2563eb' },
  confPct: { fontSize: 10, color: '#999', minWidth: 28, textAlign: 'right' },
  inquire: { alignSelf: 'flex-start', marginTop: 2, fontSize: 11, color: '#2563eb', background: 'transparent', border: '1px solid #c7dbff', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' },
  link: { fontSize: 13, color: '#2563eb', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  excerpt: { fontSize: 12, color: '#777', margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  text: { fontSize: 12.5, color: '#333', margin: 0, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  code: { fontSize: 11, color: '#333', background: '#f6f6f6', borderRadius: 6, padding: 8, margin: 0, maxHeight: 96, overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  img: { maxWidth: '100%', borderRadius: 6, display: 'block' },
  remove: { flexShrink: 0, border: 'none', background: 'transparent', color: '#ccc', cursor: 'pointer', fontSize: 12, padding: '8px 6px 0', lineHeight: 1 },
};
