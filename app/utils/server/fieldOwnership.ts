import type { DispoDb, DispoTransaction } from './fieldDispo';
import { isDeniedAccount, type UserProfile } from './requireApprovedUser';
import { prepareTerritories, type PreparedTerritory } from '@/app/utils/effectiveOwner';

/**
 * adminSettings/fieldOwnership { mode: 'territory' | 'legacy' }.
 * A missing, unreadable, or unrecognised doc means legacy (today's rules, no
 * behavior change). Only the Admin SDK writes adminSettings (firestore.rules).
 */
export type OwnershipMode = 'legacy' | 'territory';
export const OWNERSHIP_FLAG_COLLECTION = 'adminSettings';
export const OWNERSHIP_FLAG_DOC = 'fieldOwnership';
export const OWNERSHIP_CACHE_MS = 60_000;
/** One page of every territory doc. A full page is treated as unknown (fail to legacy). */
export const ALL_TERRITORIES_LIMIT = 500;

let modeCache: { mode: OwnershipMode; at: number } | null = null;
let territoryCache: { territories: PreparedTerritory[] | null; at: number } | null = null;

/** Tests and the flag-flip runbook. A process restart does the same. */
export function resetFieldOwnershipCaches(): void {
  modeCache = null;
  territoryCache = null;
}

/** A territory was written on this instance: re-read polygons on the next dispo. */
export function invalidateTerritoryCache(): void {
  territoryCache = null;
}

function fresh(at: number, now: number): boolean {
  return now >= at && now - at < OWNERSHIP_CACHE_MS;
}

export async function readOwnershipMode(
  db: DispoDb,
  tx: DispoTransaction,
  now: number,
): Promise<OwnershipMode> {
  if (modeCache && fresh(modeCache.at, now)) return modeCache.mode;
  let mode: OwnershipMode = 'legacy';
  try {
    const snap = await tx.get(db.collection(OWNERSHIP_FLAG_COLLECTION).doc(OWNERSHIP_FLAG_DOC));
    const value = snap.exists ? (snap.data() ?? {}).mode : undefined;
    if (value === 'territory') mode = 'territory';
  } catch {
    mode = 'legacy';
  }
  modeCache = { mode, at: now };
  return mode;
}

/**
 * All live territories, bbox-ready, cached 60 s per instance. Null means the
 * list is unavailable or possibly truncated; callers fall back to legacy rules.
 */
export async function loadLiveTerritories(
  db: DispoDb,
  tx: DispoTransaction,
  now: number,
): Promise<PreparedTerritory[] | null> {
  if (territoryCache && fresh(territoryCache.at, now)) return territoryCache.territories;
  let territories: PreparedTerritory[] | null = null;
  const collection = db.collection('territories');
  if (collection.cappedGet) {
    try {
      const snap = await tx.getQuery(collection.cappedGet(ALL_TERRITORIES_LIMIT));
      if (snap.docs.length < ALL_TERRITORIES_LIMIT) {
        territories = prepareTerritories(snap.docs.map((doc) => ({ id: doc.id, data: doc.data() ?? {} })));
      } else {
        console.log('[field/dispo] all_territories_truncated 1');
      }
    } catch {
      territories = null;
    }
  }
  territoryCache = { territories, at: now };
  return territories;
}

/** A Go Back setter who left (deleted, deactivated, pending deletion, or missing) no longer holds pins. */
export async function goBackSetterActive(
  db: DispoDb,
  tx: DispoTransaction,
  setterId: string,
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(setterId)) return false;
  const snap = await tx.get(db.collection('users').doc(setterId));
  return !isDeniedAccount(snap.exists, snap.data() as UserProfile | undefined);
}
