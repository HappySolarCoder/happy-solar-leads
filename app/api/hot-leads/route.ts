import { NextRequest, NextResponse } from 'next/server';
import { FieldPath, type Query } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { requireApprovedRequestUser } from '@/app/utils/server/requireApprovedUser';
import {
  applyLatBand,
  serveHotLeads,
  type HotLeadResult,
  type HotLeadStore,
  type LatQueryCall,
} from '@/app/utils/server/hotLeads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LatChain = {
  where(field: string, op: string, value: number): LatChain;
  orderBy(field: unknown): LatChain;
  limit(n: number): LatChain;
  startAfter(lat: number, id: string): LatChain;
};

function liveStore(): HotLeadStore {
  const db = adminDb();
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
  };
}

function respond(result: HotLeadResult) {
  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
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
      store: liveStore(),
    },
  });
  return respond(result);
}
