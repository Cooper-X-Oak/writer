'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { listFeeds, addFeed, removeFeed } from '../lib/api/feeds';

export interface UseFeeds {
  feeds: string[];
  busy: boolean;
  add: (url: string) => Promise<void>;
  remove: (url: string) => Promise<void>;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The user's RSS feed list. Loads on mount; add/remove return the new list. `onError` surfaces a
 *  failure message (the studio routes it to its status line). Extracted from write-studio (A4). */
export function useFeeds(onError?: (msg: string) => void): UseFeeds {
  const [feeds, setFeeds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setFeeds(await listFeeds());
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (op: () => Promise<string[]>): Promise<void> => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        setFeeds(await op());
      } catch (e: unknown) {
        onError?.(errMsg(e));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onError],
  );

  const add = useCallback((url: string) => run(() => addFeed(url)), [run]);
  const remove = useCallback((url: string) => run(() => removeFeed(url)), [run]);

  return { feeds, busy, add, remove };
}
