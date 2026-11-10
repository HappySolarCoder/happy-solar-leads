'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/app/utils/firebase';
import { getTerritoriesAsync } from '@/app/utils/territories';
import { prepareTerritories, type PreparedTerritory } from '@/app/utils/effectiveOwner';

export type FieldOwnershipView = {
  /** 'territory' only when adminSettings/fieldOwnership.mode == 'territory'. Anything else is today's display. */
  mode: 'legacy' | 'territory';
  territories: PreparedTerritory[];
};

const TTL_MS = 60_000;
const OFF: FieldOwnershipView = { mode: 'legacy', territories: [] };
let cached: { at: number; value: FieldOwnershipView } | null = null;
let pending: Promise<FieldOwnershipView> | null = null;

export async function loadFieldOwnership(): Promise<FieldOwnershipView> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    let value = OFF;
    try {
      if (db) {
        const flag = await getDoc(doc(db, 'adminSettings', 'fieldOwnership'));
        if (flag.exists() && flag.data()?.mode === 'territory') {
          const rows = await getTerritoriesAsync();
          value = {
            mode: 'territory',
            territories: prepareTerritories(
              (rows as unknown as Array<Record<string, unknown> & { id: string }>).map((row) => ({ id: row.id, data: row })),
            ),
          };
        }
      }
    } catch {
      value = OFF;
    }
    cached = { at: Date.now(), value };
    pending = null;
    return value;
  })();
  return pending;
}

/** Display-only. Flag OFF or any failure returns the legacy view, so the map is unchanged. */
export function useFieldOwnership(): FieldOwnershipView {
  const [view, setView] = useState<FieldOwnershipView>(cached?.value ?? OFF);
  useEffect(() => {
    let alive = true;
    void loadFieldOwnership().then((value) => {
      if (alive) setView(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return view;
}
