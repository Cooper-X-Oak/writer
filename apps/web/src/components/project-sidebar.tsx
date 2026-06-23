'use client';

import type { Project } from '@app/contracts';

interface ProjectSidebarProps {
  projects: Project[];
  selectedId: string | null;
  onSelect: (project: Project) => void;
  onNew: () => void;
  onDelete: (project: Project) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export function ProjectSidebar({ projects, selectedId, onSelect, onNew, onDelete }: ProjectSidebarProps) {
  return (
    <aside className="folder-rail" style={styles.aside}>
      <button style={styles.newBtn} onClick={onNew}>
        ＋ 新建案卷
      </button>
      <h2 style={styles.heading}>案卷</h2>
      {projects.length === 0 ? (
        <p style={styles.empty}>还没有作品，写完会自动保存到这里。</p>
      ) : (
        <ul style={styles.list}>
          {projects.map((p) => {
            const active = p.id === selectedId;
            return (
              <li key={p.id} style={styles.row}>
                <button
                  style={{ ...styles.item, ...(active ? styles.itemActive : null) }}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onSelect(p)}
                >
                  <span style={styles.title}>{p.title}</span>
                  <time style={styles.time}>{formatDate(p.createdAt)}</time>
                </button>
                <button
                  style={styles.del}
                  aria-label={`删除 ${p.title}`}
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation(); // don't also open the project
                    onDelete(p);
                  }}
                >
                  ✕
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
  aside: { width: 232, flexShrink: 0, borderRight: '1px solid var(--rule)', paddingRight: 16 },
  newBtn: {
    width: '100%',
    padding: '9px 12px',
    fontFamily: 'var(--font-chrome)',
    fontSize: 13.5,
    fontWeight: 600,
    color: 'var(--ink)',
    background: 'var(--paper)',
    border: '1px solid var(--deckle)',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--lift-sm)',
    cursor: 'pointer',
  },
  heading: { margin: '20px 0 8px', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-meta)', letterSpacing: '0.14em', color: 'var(--ink-faint)', textTransform: 'uppercase' },
  empty: { fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.6 },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 3 },
  row: { display: 'flex', alignItems: 'center', gap: 2 },
  del: {
    flexShrink: 0,
    border: 'none',
    background: 'transparent',
    color: 'var(--ink-faint)',
    cursor: 'pointer',
    fontSize: 12,
    padding: '0 6px',
    lineHeight: 1,
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: 1,
    minWidth: 0,
    padding: '8px 10px 8px 11px',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    borderLeft: '2px solid transparent', // folder-tab edge, colored when active
    borderRadius: '0 var(--radius) var(--radius) 0',
    cursor: 'pointer',
    transition: 'background var(--dur-card) var(--ease-expo)',
  },
  itemActive: { background: 'var(--paper)', borderLeftColor: 'var(--edge-primary)', boxShadow: 'var(--lift-sm)' },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 14.5,
    color: 'var(--ink)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 200,
  },
  time: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-faint)' },
};
