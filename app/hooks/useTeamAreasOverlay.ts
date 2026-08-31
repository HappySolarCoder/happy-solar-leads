'use client';

import { useEffect, useRef, useState } from 'react';
import {
  TEAM_AREAS_REFRESH_MS,
  loadTeamAreasOverlay,
  publishTeamLocation,
  shouldPublishTeamLocation,
  type TeamAreaMember,
} from '@/app/utils/teamAreas';
import type { Territory } from '@/app/types/territory';
import { auth } from '@/app/utils/firebase';
import { getTerritoriesAsync } from '@/app/utils/territories';

async function getToken(): Promise<string | null> {
  if (!auth?.currentUser) return null;
  return auth.currentUser.getIdToken();
}

export function useTeamAreasOverlay(
  enabled: boolean,
  gpsPosition?: { lat: number; lng: number } | null
) {
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [members, setMembers] = useState<TeamAreaMember[]>([]);
  const lastPublishedRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setTerritories([]);
      setMembers([]);
      lastPublishedRef.current = null;
      return;
    }

    let cancelled = false;

    async function load() {
      const overlay = await loadTeamAreasOverlay(getToken, getTerritoriesAsync);
      if (cancelled) return;
      setTerritories(overlay.territories);
      setMembers(overlay.members);
    }

    load();
    const interval = setInterval(load, TEAM_AREAS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !gpsPosition) return;

    let cancelled = false;
    const publish = (force: boolean) => {
      const next = { lat: gpsPosition.lat, lng: gpsPosition.lng };
      if (!force && !shouldPublishTeamLocation(lastPublishedRef.current, next)) return;
      publishTeamLocation(next.lat, next.lng, getToken).then((ok) => {
        if (!cancelled && ok) lastPublishedRef.current = next;
      });
    };

    publish(false);
    const interval = setInterval(() => publish(true), TEAM_AREAS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, gpsPosition?.lat, gpsPosition?.lng]);

  return { territories, members };
}
