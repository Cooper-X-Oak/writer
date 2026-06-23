'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MaterialCard } from '@app/contracts';
import {
  listInbox,
  addInboxLink,
  addInboxText,
  addInboxCode,
  addInboxImage,
  addInboxHotspot,
  removeInboxItem,
} from '../lib/api/inbox';

export interface UseInbox {
  items: MaterialCard[];
  busy: boolean;
  reload: () => Promise<void>;
  addUrl: (url: string) => Promise<void>;
  addText: (body: string, kind: 'text' | 'md' | 'code') => Promise<void>;
  addImage: (file: File) => Promise<void>;
  addHotspot: (hotspotId: string) => Promise<void>;
  remove: (cardId: string) => void;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The GLOBAL planning-desk inbox — project-independent material staging. Drops on the desk (no
 *  project) land here instead of forcing a corpus project (A5). Mirrors the studio's corpus-ingest
 *  pattern but targets /api/inbox. Created in A4; wired into PlanningDesk in A5/A7. */
export function useInbox(onError?: (msg: string) => void): UseInbox {
  const [items, setItems] = useState<MaterialCard[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setItems(await listInbox());
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const ingest = useCallback(
    async (add: () => Promise<unknown>): Promise<void> => {
      setBusy(true);
      try {
        await add();
        setItems(await listInbox());
      } catch (e: unknown) {
        onError?.(errMsg(e));
      } finally {
        setBusy(false);
      }
    },
    [onError],
  );

  const addUrl = useCallback((url: string) => ingest(() => addInboxLink({ url })), [ingest]);
  const addText = useCallback(
    (body: string, kind: 'text' | 'md' | 'code') =>
      ingest(() => (kind === 'code' ? addInboxCode({ snippet: body }) : addInboxText({ kind, body }))),
    [ingest],
  );
  const addImage = useCallback((file: File) => ingest(() => addInboxImage(file)), [ingest]);
  const addHotspot = useCallback((hotspotId: string) => ingest(() => addInboxHotspot(hotspotId)), [ingest]);
  const remove = useCallback(
    (cardId: string): void => {
      setItems((cs) => cs.filter((c) => c.id !== cardId)); // optimistic
      void removeInboxItem(cardId).catch(() => void reload());
    },
    [reload],
  );

  return { items, busy, reload, addUrl, addText, addImage, addHotspot, remove };
}
