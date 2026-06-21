'use client';

import type { Project } from '@app/contracts';

interface ProjectSidebarProps {
  projects: Project[];
  selectedId: string | null;
  onSelect: (project: Project) => void;
  onNew: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export function ProjectSidebar({ projects, selectedId, onSelect, onNew }: ProjectSidebarProps) {
  return (
    <aside style={styles.aside}>
      <button style={styles.newBtn} onClick={onNew}>
        ＋ 新写作
      </button>
      <h2 style={styles.heading}>作品</h2>
      {projects.length === 0 ? (
        <p style={styles.empty}>还没有作品，写完会自动保存到这里。</p>
      ) : (
        <ul style={styles.list}>
          {projects.map((p) => {
            const active = p.id === selectedId;
            return (
              <li key={p.id}>
                <button
                  style={{ ...styles.item, ...(active ? styles.itemActive : null) }}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onSelect(p)}
                >
                  <span style={styles.title}>{p.title}</span>
                  <time style={styles.time}>{formatDate(p.createdAt)}</time>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  aside: { width: 240, flexShrink: 0, borderRight: '1px solid #ececec', paddingRight: 16 },
  newBtn: {
    width: '100%',
    padding: '8px 12px',
    fontSize: 14,
    fontWeight: 600,
    color: '#111',
    background: '#fff',
    border: '1px solid #d0d0d0',
    borderRadius: 8,
    cursor: 'pointer',
  },
  heading: { margin: '18px 0 8px', fontSize: 12, letterSpacing: 1, color: '#999', textTransform: 'uppercase' },
  empty: { fontSize: 13, color: '#999', lineHeight: 1.6 },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  item: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    width: '100%',
    padding: '8px 10px',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  itemActive: { background: '#f0f0f0' },
  title: {
    fontSize: 14,
    color: '#1a1a1a',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 210,
  },
  time: { fontSize: 11, color: '#aaa' },
};
