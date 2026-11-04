import { NextRequest, NextResponse } from 'next/server';
import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type Transaction,
  type UpdateData,
} from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { requireApprovedRequestUser } from '@/app/utils/server/requireApprovedUser';
import {
  handleHotLeadClaim,
  type ClaimDb,
  type ClaimSnap,
  type ClaimTx,
  type HotLeadResult,
  type TerritoryRead,
} from '@/app/utils/server/hotLeads';
import { TERRITORY_QUERY_LIMIT } from '@/app/utils/server/territoryGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CLAIM_BODY_MAX = 2 * 1024;

function snapOf(id: string, snap: { exists: boolean; data: () => DocumentData | undefined }): ClaimSnap {
  return {
    exists: snap.exists,
    id,
    data: () => snap.data() as Record<string, unknown> | undefined,
  };
}

function claimSession(): { db: ClaimDb; territories: (tx: ClaimTx, uid: string) => Promise<TerritoryRead> } {
  const db = adminDb();
  let native: Transaction | null = null;
  return {
    db: {
      runTransaction(fn) {
        return db.runTransaction(async (tx) => {
          native = tx;
          try {
            return await fn({
              async get(path) {
                const slash = path.indexOf('/');
                const ref = db.collection(path.slice(0, slash)).doc(path.slice(slash + 1));
                return snapOf(ref.id, await tx.get(ref));
              },
              update(path, data) {
                const slash = path.indexOf('/');
                const ref = db.collection(path.slice(0, slash)).doc(path.slice(slash + 1));
                tx.update(ref, data as UpdateData<DocumentData>);
              },
              create(path, data) {
                const slash = path.indexOf('/');
                const ref = db.collection(path.slice(0, slash)).doc(path.slice(slash + 1));
                tx.create(ref, data);
              },
            });
          } finally {
            native = null;
          }
        });
      },
    },
    async territories(_tx, uid) {
      if (!native) throw new Error('Hot-lead territory read must run inside the claim transaction');
      const snap = await native.get(
        db.collection('territories').where('userId', '==', uid).limit(TERRITORY_QUERY_LIMIT),
      );
      return {
        docs: snap.docs.map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> })),
        truncated: snap.docs.length >= TERRITORY_QUERY_LIMIT,
      };
    },
  };
}

function respond(result: HotLeadResult) {
  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
}

export async function POST(request: NextRequest) {
  try {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > CLAIM_BODY_MAX) {
      console.log('[hot-leads] 413 0');
      return NextResponse.json(
        { ok: false, error: 'too_large' },
        { status: 413, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    const rawBody = await request.text();
    const session = claimSession();
    const result = await handleHotLeadClaim({
      authorization: request.headers.get('authorization'),
      rawBody,
      loadApprovedUser: () => requireApprovedRequestUser(request),
      deps: {
        verifyIdToken: (token, checkRevoked) => adminAuth().verifyIdToken(token, checkRevoked),
        getUser: async (uid) => {
          const doc = await adminDb().collection('users').doc(uid).get();
          return { exists: doc.exists, data: doc.data() };
        },
        db: session.db,
        territories: session.territories,
        Timestamp,
        serverTimestamp: () => FieldValue.serverTimestamp(),
      },
    });
    return respond(result);
  } catch {
    console.log('[hot-leads] 500 internal');
    return NextResponse.json(
      { ok: false, error: 'internal' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
