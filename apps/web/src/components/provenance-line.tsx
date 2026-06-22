'use client';

import type { WriteSource } from '@app/contracts';
import { sourceLabel, hostnameOf } from '../lib/format/provenance';
import { formatRelative } from '../lib/format/relative-time';

interface ProvenanceLineProps {
  source: WriteSource;
}

/** "来源" line under the title: where this draft was seeded from — source badge + outbound link to
 *  the originating item + when it was collected. Only rendered when the project carries a source. */
export function ProvenanceLine({ source }: ProvenanceLineProps) {
  const now = Date.now(); // relative-time label is day/hour granularity — recompute per render is fine
  const isHn = source.sourceType === 'hn';
  return (
    <p style={styles.line}>
      <span style={styles.label}>来源</span>
      <span style={{ ...styles.badge, ...(isHn ? styles.badgeHn : styles.badgeRss) }}>{sourceLabel(source.sourceType)}</span>
      <a style={styles.link} href={source.url} target="_blank" rel="noopener noreferrer" title={source.url}>
        {hostnameOf(source.url)} ↗
      </a>
      <span style={styles.dot}>·</span>
      <span style={styles.time}>采集于 {formatRelative(source.collectedAt, now)}</span>
    </p>
  );
}

const styles: Record<string, React.CSSProperties> = {
  line: { display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 16px', fontSize: 12.5, color: '#888' },
  label: { color: '#aaa', letterSpacing: 0.5 },
  badge: { fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, letterSpacing: 0.5, color: '#fff' },
  badgeHn: { background: '#ff6600' },
  badgeRss: { background: '#0a7d36' },
  link: { color: '#2563eb', textDecoration: 'none', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dot: { color: '#ccc' },
  time: { color: '#999' },
};
