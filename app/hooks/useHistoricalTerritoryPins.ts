'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/app/utils/firebase';
import type { Lead } from '@/app/types';

type HistoricalPinPayload = {
  id?: string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;
  status?: string;
  disposition?: string;
  claimedBy?: string;
  assignedTo?: string;
  createdAt?: string;
  dispositionedAt?: string;
  historicalSetByName?: string;
};

function toLead(raw: HistoricalPinPayload): Lead {
  return {
    id: String(raw.id || ''),
    name: raw.name || 'Past pin',
    address: raw.address || '',
    city: raw.city || '',
    state: raw.state || '',
    zip: raw.zip || '',
    lat: raw.lat,
    lng: raw.lng,
    status: raw.status || '',
    disposition: raw.disposition,
    claimedBy: raw.claimedBy,
    assignedTo: raw.assignedTo,
    createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date(0),
    dispositionedAt: raw.dispositionedAt ? new Date(raw.dispositionedAt) : undefined,
    historicalTerritoryPin: true,
    historicalSetByName: raw.historicalSetByName,
  };
}

/**
 * Other reps' Appointment Set and Sold pins inside the signed-in user's
 * territory polygons. Empty when the user has no territory.
 */
export function useHistoricalTerritoryPins(userId?: string): Lead[] {
  const [pins, setPins] = useState<Lead[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    async function load() {
      const token = await auth?.currentUser?.getIdToken();
      if (!token || cancelled) return;

      const res = await fetch('/api/historical-territory-pins', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.warn('[historical-territory-pins] request failed', res.status);
        return;
      }

      const data = (await res.json()) as { pins?: HistoricalPinPayload[] };
      if (cancelled) return;
      const next = Array.isArray(data.pins) ? data.pins.map(toLead) : [];
      setPins(next);
      setLoadedFor(userId);
    }

    load().catch((error) => {
      console.warn('[historical-territory-pins] load failed', error);
    });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId || loadedFor !== userId) return [];
  return pins;
}
