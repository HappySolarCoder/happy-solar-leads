'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/app/utils/firebase';
import type { Territory } from '@/app/types/territory';
import type { TeamAreaMember } from '@/app/utils/teamAreas';

/**
 * When the field toggle is ON, load existing territories via the
 * authenticated Admin SDK route. Does not query Firestore from the browser.
 */
export function useTeamAreasOverlay(enabled: boolean) {
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [members, setMembers] = useState<TeamAreaMember[]>([]);

  useEffect(() => {
    if (!enabled) {
      setTerritories([]);
      setMembers([]);
      return;
    }

    let cancelled = false;

    async function load() {
      const token = await auth?.currentUser?.getIdToken();
      if (!token) return;

      const res = await fetch('/api/team-areas', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.warn('[teamAreas] Overlay API failed', res.status);
        return;
      }

      const data = await res.json();
      if (cancelled) return;
      setTerritories(Array.isArray(data.territories) ? data.territories : []);
      setMembers(Array.isArray(data.members) ? data.members : []);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { territories, members };
}
