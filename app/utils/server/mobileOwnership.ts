import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import {
  effectiveOwner,
  goBackSetter,
  isExpiredGoBack,
  popupExemptFor,
  prepareTerritories,
  territoriesFor,
  type PreparedTerritory,
} from '@/app/utils/effectiveOwner';
import { isDeniedAccount } from './requireApprovedUser';
import { mobileKnockEvents, type MobileKnockEvent } from '@/app/utils/fieldKnockEvents';

/**
 * Per-row ownership for /api/mobile-leads, all server-side so the phone never
 * runs point-in-polygon or depends on GPS. Only emitted when
 * adminSettings/fieldOwnership.mode == 'territory'; otherwise rows are exactly
 * what they are today and `ownership` is 'legacy'.
 *
 * Row fields (additive):
 *   ownedByMe            boolean  caller is one of ownerIds
 *   owners               [{uid,name}] up to 5; dual owners are all listed, first = newest assignment
 *   ownerSource          'territory' | 'go-back' | 'stamp' | 'none'
 *   expiredGoBack        boolean  status go-back and older than 90 d (derived, never stored)
 *   inOtherUsersTerritory boolean pin is in a live territory and the caller is not one of its owners
 * Response field: popupExempt boolean (caller-specific; staff true, final per Evan).
 * Warn on place/dispo when: inOtherUsersTerritory && !popupExempt.
 */
export const MOBILE_ALL_TERRITORIES_LIMIT = 500;
export const MOBILE_EVENT_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;
export const MOBILE_EVENT_READ_LIMIT = 600;
export const MOBILE_EVENT_RETURN_LIMIT = 500;
const OWNERS_MAX = 5;
/** Mode flag: re-read every 60 s so a flag flip reaches phones within a minute. */
const CACHE_MS = 60_000;
/**
 * Territory polygons: ~1.8 MB / 73 docs / ~1 s per cold read (measured Nov 10), re-read at most every
 * 5 min per instance. Reassignments are rare and the server refusal gate has its own 60 s cache and is the
 * authority (a stale display can only mis-show a label or popup; a knock is never lost, it is counted_only).
 * Territory writes through /api/territory-management clear it on the instance that handled them.
 */
export const TERRITORY_CACHE_MS = 5 * 60_000;
const DIRECTORY_CACHE_MS = 10 * 60_000;

type Ctx = { mode: 'legacy' | 'territory'; territories: PreparedTerritory[] | null };
let ctxCache: { at: number; value: Ctx } | null = null;
let territoryCache: { at: number; territories: PreparedTerritory[] } | null = null;
const directory = new Map<string, { at: number; name: string | null; active: boolean }>();

export function resetMobileOwnershipCaches(): void {
  ctxCache = null;
  territoryCache = null;
  directory.clear();
}

/** A territory was written on this instance: re-read polygons on the next request. */
export function invalidateMobileTerritoryCache(): void {
  territoryCache = null;
  ctxCache = null;
}

async function loadTerritories(db: Firestore, now: number): Promise<PreparedTerritory[] | null> {
  if (territoryCache && now >= territoryCache.at && now - territoryCache.at < TERRITORY_CACHE_MS) return territoryCache.territories;
  try {
    const snap = await db
      .collection('territories')
      .select('userId', 'userIds', 'userName', 'userColor', 'polygon', 'archived', 'assignedAt', 'createdAt')
      .limit(MOBILE_ALL_TERRITORIES_LIMIT)
      .get();
    if (snap.size >= MOBILE_ALL_TERRITORIES_LIMIT) {
      console.log('[mobile/leads] all_territories_truncated 1');
      territoryCache = null;
      return null;
    }
    const territories = prepareTerritories(snap.docs.map((d) => ({ id: d.id, data: d.data() })));
    territoryCache = { at: now, territories };
    return territories;
  } catch (error) {
    // A failed re-read keeps serving the last good list rather than dropping every phone to legacy.
    if (territoryCache) return territoryCache.territories;
    throw error;
  }
}

export async function loadOwnershipContext(db: Firestore, now: number): Promise<Ctx> {
  if (ctxCache && now >= ctxCache.at && now - ctxCache.at < CACHE_MS) return ctxCache.value;
  let value: Ctx = { mode: 'legacy', territories: null };
  try {
    const flag = await db.collection('adminSettings').doc('fieldOwnership').get();
    if (flag.exists && flag.data()?.mode === 'territory') {
      const territories = await loadTerritories(db, now);
      if (territories) value = { mode: 'territory', territories };
    }
  } catch {
    value = { mode: 'legacy', territories: null };
  }
  ctxCache = { at: now, value };
  return value;
}

async function loadDirectory(db: Firestore, uids: string[], now: number): Promise<void> {
  const missing = [...new Set(uids)].filter((uid) => {
    const hit = directory.get(uid);
    return /^[A-Za-z0-9_-]{1,128}$/.test(uid) && !(hit && now - hit.at < DIRECTORY_CACHE_MS);
  });
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const snaps = await db.getAll(...chunk.map((uid) => db.collection('users').doc(uid)), {
      fieldMask: ['name', 'isActive', 'deleted', 'deletionPending', 'approved', 'approvalStatus', 'status'],
    });
    snaps.forEach((snap, index) => {
      const data = snap.data();
      const name = typeof data?.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 80) : null;
      directory.set(chunk[index], { at: now, name, active: !isDeniedAccount(snap.exists, data) });
    });
  }
}

export type OwnershipFields = {
  ownedByMe: boolean;
  owners: Array<{ uid: string; name: string | null }>;
  ownerSource: string;
  expiredGoBack: boolean;
  inOtherUsersTerritory: boolean;
};

/** Returns one fields object per input row (same order). Null entries when ownership is legacy. */
export async function ownershipForRows(
  db: Firestore,
  ctx: Ctx,
  rows: ReadonlyArray<Record<string, unknown>>,
  uid: string,
  now: number,
): Promise<Array<OwnershipFields | null>> {
  if (ctx.mode !== 'territory' || !ctx.territories) return rows.map(() => null);
  const territories = ctx.territories;
  const setters = rows.map((row) => goBackSetter(row)).filter((id): id is string => Boolean(id) && id !== uid);
  await loadDirectory(db, setters, now);
  const active = (id: string) => id === uid || directory.get(id)?.active !== false;
  const owned = rows.map((row) => effectiveOwner(row, territories, now, { setterActive: active }));
  await loadDirectory(db, owned.flatMap((o) => o.ownerIds.slice(0, OWNERS_MAX)), now);
  return rows.map((row, index) => {
    const owner = owned[index];
    const ownedByMe = owner.ownerIds.includes(uid);
    const inTerritory = territoriesFor(row.lat, row.lng, territories);
    const territoryOwners = new Set(inTerritory.flatMap((t) => t.userIds));
    return {
      ownedByMe,
      owners: owner.ownerIds.slice(0, OWNERS_MAX).map((id) => ({ uid: id, name: directory.get(id)?.name ?? null })),
      ownerSource: owner.source,
      expiredGoBack: isExpiredGoBack(row, now),
      inOtherUsersTerritory: inTerritory.length > 0 && !ownedByMe && !territoryOwners.has(uid),
    };
  });
}

export function popupExemptForRole(role: unknown): boolean {
  return popupExemptFor(role);
}

/** The caller's own counts-only knocks, last 45 days. One doc-id range read, no index. */
export async function loadOwnKnockEvents(db: Firestore, uid: string, now: number): Promise<MobileKnockEvent[]> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return [];
  const snap = await db
    .collection('fieldKnockEvents')
    .orderBy(FieldPath.documentId())
    .startAt(`${uid}_`)
    .endAt(`${uid}_\uf8ff`)
    .select('uid', 'leadId', 'actionAt', 'dispositionId', 'status', 'disposition')
    .limit(MOBILE_EVENT_READ_LIMIT)
    .get();
  if (snap.size >= MOBILE_EVENT_READ_LIMIT) console.log('[mobile/leads] knock_events_capped 1');
  const since = now - MOBILE_EVENT_WINDOW_MS;
  return mobileKnockEvents(snap.docs.map((d) => d.data()))
    .filter((event) => event.at >= since)
    .sort((a, b) => b.at - a.at)
    .slice(0, MOBILE_EVENT_RETURN_LIMIT);
}
