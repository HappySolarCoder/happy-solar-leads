import { NextRequest, NextResponse } from 'next/server';
import { FieldPath, type Firestore, type Query } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { requireApprovedRequestUser, requireApprovedUser, type RequireApprovedUserDeps } from '@/app/utils/server/requireApprovedUser';
import {
  applyLatBand,
  describePointsQuery,
  serveHotLeads,
  type HotLeadResult,
  type HotLeadStore,
  type LatQueryCall,
  type PointsQueryCall,
  type TerritoryRead,
} from '@/app/utils/server/hotLeads';
import { TERRITORY_QUERY_LIMIT } from '@/app/utils/server/territoryGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LatChain = {
  where(field: string, op: string, value: number): LatChain;
  orderBy(field: unknown): LatChain;
  limit(n: number): LatChain;
  startAfter(lat: number, id: string): LatChain;
};

export type HotLeadsRouteDeps = RequireApprovedUserDeps & {
  store: HotLeadStore;
  territories?: (uid: string) => Promise<TerritoryRead>;
  now?: () => number;
};

async function loadCallerTerritories(db: Firestore, uid: string): Promise<TerritoryRead> {
  const snap = await db
    .collection('territories')
    .where('userId', '==', uid)
    .limit(TERRITORY_QUERY_LIMIT)
    .get();
  return {
    docs: snap.docs.map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> })),
    truncated: snap.docs.length >= TERRITORY_QUERY_LIMIT,
  };
}

export function liveStore(db: Firestore): HotLeadStore {
  return {
    async latBand(spec: LatQueryCall) {
      const query = applyLatBand(db.collection('hotLeads') as unknown as LatChain, spec, FieldPath.documentId());
      const snap = await (query as unknown as Query).get();
      return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }));
    },
    async getById(id: string) {
      const doc = await db.collection('hotLeads').doc(id).get();
      if (!doc.exists) return null;
      return { id: doc.id, data: (doc.data() ?? {}) as Record<string, unknown> };
    },
    async pointsOverview(spec: PointsQueryCall) {
      const expected = describePointsQuery();
      if (spec.limit !== expected.limit) {
        throw new Error('Hot lead points page size is fixed');
      }
      if (spec.select.length !== expected.select.length || spec.select.some((field, index) => field !== expected.select[index])) {
        throw new Error('Hot lead points select is fixed');
      }
      const snap = await db.collection('hotLeads').select(...spec.select).limit(spec.limit).get();
      return snap.docs.map((doc) => ({ id: doc.id, data: (doc.data() ?? {}) as Record<string, unknown> }));
    },
  };
}

function respond(result: HotLeadResult) {
  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
}

export function createHotLeadsGet(deps: HotLeadsRouteDeps) {
  return async function GET(request: NextRequest) {
    const result = await serveHotLeads({
      authorization: request.headers.get('authorization'),
      params: request.nextUrl.searchParams,
      loadApprovedUser: () => requireApprovedUser(request.headers.get('authorization'), deps),
      deps,
    });
    return respond(result);
  };
}

export async function GET(request: NextRequest) {
  const db = adminDb();
  const result = await serveHotLeads({
    authorization: request.headers.get('authorization'),
    params: request.nextUrl.searchParams,
    loadApprovedUser: () => requireApprovedRequestUser(request),
    deps: {
      verifyIdToken: (token, checkRevoked) => adminAuth().verifyIdToken(token, checkRevoked),
      getUser: async (uid) => {
        const doc = await db.collection('users').doc(uid).get();
        return { exists: doc.exists, data: doc.data() };
      },
      store: liveStore(db),
      territories: (uid) => loadCallerTerritories(db, uid),
    },
  });
  return respond(result);
}
