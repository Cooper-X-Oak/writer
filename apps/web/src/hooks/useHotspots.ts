'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Hotspot } from '@app/contracts';
import { listHotspots, refreshHotspots, dismissHotspot } from '../lib/api/hotspots';

export interface UseHotspots {
  hotspots: Hotspot[];
  refreshing: boolean;
  refresh: () => Promise<void>;
  dismiss: (h: Hotspot) => Promise<void>;
}

/** The global hotspot wall (HN/RSS discovery feed). Loads on mount; refresh re-collects; dismiss is
 *  optimistic with rollback. Extracted verbatim from write-studio (A4 — no behavior change). */
export function useHotspots(): UseHotspots {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setHotspots(await listHotspots());
    } catch {
      // best-effort; empty until the first refresh
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async (): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRefreshing(true);
    try {
      setHotspots(await refreshHotspots());
    } catch {
      // best-effort; keep the existing list on failure
    } finally {
      busyRef.current = false;
      setRefreshing(false);
    }
  }, []);

  const dismiss = useCallback(
    async (h: Hotspot): Promise<void> => {
      setHotspots((list) => list.filter((x) => x.id !== h.id)); // optimistic
      try {
        await dismissHotspot(h.id);
      } catch {
        void load(); // roll back to the server's truth on failure
      }
    },
    [load],
  );

  return { hotspots, refreshing, refresh, dismiss };
}
