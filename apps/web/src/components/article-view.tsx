'use client';

import { useEffect, useRef } from 'react';
import { buildPreviewSrcDoc, isPreviewSelect } from '../lib/preview/bridge';

interface ArticleViewProps {
  html: string;
  /** Enable hover-outline + click-to-select of [data-block] paragraphs. */
  editMode?: boolean;
  /** Base URL for resolving the article's relative image srcs inside the sandboxed iframe. */
  imageBaseUrl?: string;
  onSelectBlock?: (blockId: string, text: string) => void;
}

/** Sandboxed preview. sandbox="allow-scripts" runs the bridge but withholds allow-same-origin, so
 *  the frame can't reach the parent origin/cookies — the security boundary. The parent only trusts
 *  messages whose event.source IS this iframe's window (see isPreviewSelect). */
export function ArticleView({ html, editMode = false, imageBaseUrl, onSelectBlock }: ArticleViewProps) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!editMode || !onSelectBlock) return undefined;
    const handler = (ev: MessageEvent): void => {
      if (!isPreviewSelect(ev, ref.current?.contentWindow)) return;
      onSelectBlock(ev.data.blockId, ev.data.text);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [editMode, onSelectBlock]);

  return (
    <iframe
      ref={ref}
      title="文章预览"
      srcDoc={buildPreviewSrcDoc(html, editMode, imageBaseUrl)}
      sandbox="allow-scripts"
      style={styles.frame}
    />
  );
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
