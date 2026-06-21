'use client';

interface ArticleViewProps {
  html: string;
}

/** Read-only viewer for a saved article. sandbox="" fully locks the frame (no scripts, no forms,
 *  no same-origin), so even malformed/hostile stored HTML can't execute. This is intentionally NOT
 *  the P4 edit bridge — just a safe preview of the persisted document. */
export function ArticleView({ html }: ArticleViewProps) {
  return <iframe title="文章预览" srcDoc={html} sandbox="" style={styles.frame} />;
}

const styles: Record<string, React.CSSProperties> = {
  frame: {
    width: '100%',
    minHeight: 480,
    border: '1px solid #ececec',
    borderRadius: 12,
    background: '#fff',
  },
};
