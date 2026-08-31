'use client';

import { useEffect, useState } from 'react';
import { getTerritoriesAsync } from '@/app/utils/territories';
import type { Territory } from '@/app/types/territory';

/**
 * Load existing Firestore territories only while the field toggle is on.
 * Uses getTerritoriesAsync() — no new collection or API.
 */
export function useTeamAreasOverlay(enabled: boolean) {
  const [territories, setTerritories] = useState<Territory[]>([]);

  useEffect(() => {
    if (!enabled) {
      setTerritories([]);
      return;
    }

    let cancelled = false;
    getTerritoriesAsync().then((rows) => {
      if (!cancelled) setTerritories(rows);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return territories;
}
