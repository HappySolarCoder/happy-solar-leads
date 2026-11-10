import { NextRequest, NextResponse } from 'next/server';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { FOREIGN_TERRITORY_WARNING, foreignTerritoryWarning } from '@/app/utils/effectiveOwner';
import { loadOwnershipContext, popupExemptForRole, shortOwnerNames } from './mobileOwnership';

/**
 * POST /api/field/territory-check  {lat, lng}
 *
 * Advisory only: tells the caller whether dropping a pin at this point would show the
 * "another user's territory" popup. It writes NOTHING and never blocks anything; the pin
 * create and dispo paths are unchanged. Clients fail open on timeout or error.
 *
 * Territory data comes ONLY from loadOwnershipContext (the shared per-instance cache that
 * /api/mobile-leads also fills: flag 60 s, polygons 5 min), so a warm call reads 0 territory
 * docs. Flag OFF (missing or legacy) answers 'legacy' with no territory read at all.
 *
 * 200 { ok, ownership:'territory'|'legacy', warn, popupExempt, inOtherUsersTerritory,
 *       owners:[{uid, name}] (max 5, name = "First L."), message? (only when warn) }
 * 400 { ok:false, error:'bad_coords' }   401 / 403 as /api/mobile-leads   500 { ok:false, error:'unavailable' }
 */
export const TERRITORY_CHECK_OWNERS_MAX = 5;

export type TerritoryCheckBody = {
  ok: true;
  ownership: 'territory' | 'legacy';
  warn: boolean;
  popupExempt: boolean;
  inOtherUsersTerritory: boolean;
  owners: Array<{ uid: string; name: string | null }>;
  message?: string;
};

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function validCoords(body: unknown): { lat: number; lng: number } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { lat, lng } = body as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function createTerritoryCheckHandler(deps: { adminAuth: () => Auth; adminDb: () => Firestore; now?: () => number }) {
  return async function POST(request: NextRequest) {
    try {
      const bearer = request.headers.get('authorization');
      if (!bearer?.startsWith('Bearer ')) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401, headers: NO_STORE });
      let uid: string;
      try {
        ({ uid } = await deps.adminAuth().verifyIdToken(bearer.slice(7), true));
      } catch {
        return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401, headers: NO_STORE });
      }
      const db = deps.adminDb();
      const userDoc = await db.collection('users').doc(uid).get();
      const user = userDoc.data();
      if (!userDoc.exists || user?.deleted || user?.deletionPending || user?.isActive === false || user?.approved === false || user?.approvalStatus === 'pending') {
        return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403, headers: NO_STORE });
      }
      let raw: unknown = null;
      try {
        raw = await request.json();
      } catch {
        raw = null;
      }
      const point = validCoords(raw);
      if (!point) return NextResponse.json({ ok: false, error: 'bad_coords' }, { status: 400, headers: NO_STORE });

      const now = deps.now?.() ?? Date.now();
      const popupExempt = popupExemptForRole(user?.role);
      const ctx = await loadOwnershipContext(db, now);
      if (ctx.mode !== 'territory' || !ctx.territories) {
        const body: TerritoryCheckBody = { ok: true, ownership: 'legacy', warn: false, popupExempt, inOtherUsersTerritory: false, owners: [] };
        return NextResponse.json(body, { headers: NO_STORE });
      }
      const check = foreignTerritoryWarning(point.lat, point.lng, uid, ctx.territories);
      const ownerIds = check.ownerIds.slice(0, TERRITORY_CHECK_OWNERS_MAX);
      // Names are cosmetic: a failed directory read must not turn an answer into an error.
      const names = await shortOwnerNames(db, ownerIds, now).catch(() => new Map<string, string | null>());
      const warn = check.warn && !popupExempt;
      const body: TerritoryCheckBody = {
        ok: true,
        ownership: 'territory',
        warn,
        popupExempt,
        inOtherUsersTerritory: check.warn,
        owners: ownerIds.map((id) => ({ uid: id, name: names.get(id) ?? null })),
        ...(warn ? { message: FOREIGN_TERRITORY_WARNING } : {}),
      };
      return NextResponse.json(body, { headers: NO_STORE });
    } catch {
      return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 500, headers: NO_STORE });
    }
  };
}
