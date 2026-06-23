'use client';

import type { CSSProperties } from 'react';
import type { MaterialCard, CardStance } from '@app/contracts';
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
const STANCE_SIGIL: Record<CardStance, string> = { corroborate: '＋', contradict: '≠', neutral: '·' };
const ORIGIN_GLYPH = { auto: '⌖', manual: '✎' } as const;
const ORIGIN_TITLE = { auto: '询证 · 自动采集', manual: '手工添加' } as const;

function preview(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Deterministic micro-rotation (±1.5°) seeded by the card id, so the board feels pinned-by-hand
 *  without any random source. Straightens to 0° on hover (CSS). */
function tiltOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 997;
  return ((h / 997) - 0.5) * 2 * 1.5;
}

/** One material card on the 资料区 cork board, rendered as a pinned EXHIBIT SLIP. Stock + binding edge
 *  encode 原/补/对; origin is a wax (询证) or graphite (手工) seal; stance is a thread tab + sigil;
 *  confidence a graphite numeral. User content is React text (auto-escaped) — never innerHTML. */
export function MaterialCardView({ card, projectId, onRemove, onInquire, inquiring }: MaterialCardViewProps) {
  const isAuto = card.origin === 'auto';
  const stance = isAuto ? card.stance : undefined;
  const pct = Math.round(Math.min(1, Math.max(0, card.confidence)) * 100);
  const cardStyle = { '--tilt': `${tiltOf(card.id).toFixed(2)}deg` } as CSSProperties;

  return (
    <li className="exhibit">
      <div className="exhibit-card" data-klass={card.klass} data-origin={card.origin} data-stance={stance} style={cardStyle}>
        <span className="exhibit-origin" title={ORIGIN_TITLE[card.origin]} aria-hidden>
          {ORIGIN_GLYPH[card.origin]}
        </span>
        {stance && <span className="exhibit-stance" aria-hidden />}

        <div className="exhibit-meta">
          <span>{KIND_LABEL[card.kind]}</span>
          <span className="exhibit-klass">{card.klass}</span>
          {stance && (
            <span className="exhibit-sigil" data-stance={stance} title={stance}>
              {STANCE_SIGIL[stance]}
            </span>
          )}
        </div>

        {card.kind === 'link' && (
          <a className="exhibit-link" href={card.content.url} target="_blank" rel="noopener noreferrer" title={card.content.url}>
            {card.content.title || hostnameOf(card.content.url)} ↗
          </a>
        )}
        {card.kind === 'link' && card.content.excerpt && <p className="exhibit-excerpt">{preview(card.content.excerpt)}</p>}
        {card.kind === 'image' && (
          <img className="exhibit-img" src={`${materialImageBase(projectId)}${card.content.filename}`} alt={card.content.alt} />
        )}
        {(card.kind === 'text' || card.kind === 'md') && <p className="exhibit-text">{preview(card.content.body)}</p>}
        {card.kind === 'code' && <pre className="exhibit-code">{preview(card.content.snippet, 300)}</pre>}

        {isAuto && card.note && <p className="exhibit-note">核验：{card.note}</p>}

        {(onInquire || isAuto) && (
          <div className="exhibit-foot">
            {onInquire && card.kind !== 'image' ? (
              <button className="stamp-btn" disabled={inquiring} onClick={() => onInquire(card.id)}>
                {inquiring ? '询证中…' : '盖章找佐证'}
              </button>
            ) : (
              <span />
            )}
            {isAuto && (
              <span className="exhibit-conf" title={`置信度 ${String(pct)}%`}>
                ·{pct}
              </span>
            )}
          </div>
        )}
      </div>
      <button className="exhibit-remove" aria-label={`移除这张${KIND_LABEL[card.kind]}卡`} title="移除" onClick={() => onRemove(card.id)}>
        ✕
      </button>
    </li>
  );
}
