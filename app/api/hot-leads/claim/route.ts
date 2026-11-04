import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp, type DocumentData, type UpdateData } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { requireApprovedRequestUser } from '@/app/utils/server/requireApprovedUser';
import {
  handleHotLeadClaim,
  type ClaimDb,
  type ClaimSnap,
  type HotLeadResult,
} from '@/app/utils/server/hotLeads';

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

function claimDb(): ClaimDb {
  const db = adminDb();
  return {
    runTransaction(fn) {
      return db.runTransaction(async (tx) => fn({
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
      }));
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
        db: claimDb(),
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
