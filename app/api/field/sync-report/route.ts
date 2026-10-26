import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp, type CollectionReference, type DocumentData, type Query } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import {
  handleFieldSyncReportGet,
  handleFieldSyncReportPost,
  type SyncCollection,
  type SyncQuery,
} from '@/app/utils/server/fieldSyncReport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLLECTION = 'fieldSyncReports';

function asQuery(query: Query<DocumentData>): SyncQuery {
  return {
    where(field, op, value) {
      return asQuery(query.where(field, op as FirebaseFirestore.WhereFilterOp, value as DocumentData));
    },
    orderBy(field, direction) {
      return asQuery(query.orderBy(field, direction));
    },
    limit(n) {
      return asQuery(query.limit(n));
    },
    startAfter(snapshot) {
      return asQuery(query.startAfter(snapshot as FirebaseFirestore.DocumentSnapshot));
    },
    async get() {
      const snap = await query.get();
      return {
        docs: snap.docs.map((doc) => ({
          id: doc.id,
          data: () => doc.data() as Record<string, unknown>,
        })),
      };
    },
  };
}

function collection(name: string): SyncCollection {
  if (name !== COLLECTION) {
    throw new Error('Unexpected collection');
  }
  const col: CollectionReference<DocumentData> = adminDb().collection(name);
  return {
    ...asQuery(col),
    doc(id: string) {
      const ref = col.doc(id);
      return {
        async create(data) {
          await ref.create(data as DocumentData);
        },
        async get() {
          const snap = await ref.get();
          return {
            exists: snap.exists,
            id: snap.id,
            snapshot: snap,
            data: () => snap.data() as Record<string, unknown> | undefined,
          };
        },
      };
    },
  };
}

function deps() {
  return {
    verifyIdToken: (token: string, checkRevoked: true) => adminAuth().verifyIdToken(token, checkRevoked),
    getUser: async (uid: string) => {
      const doc = await adminDb().collection('users').doc(uid).get();
      return { exists: doc.exists, data: doc.data() };
    },
    toTimestamp: (millis: number) => Timestamp.fromMillis(millis),
    serverTimestamp: () => FieldValue.serverTimestamp(),
    collection,
  };
}

function json(result: { status: number; body: Record<string, unknown>; headers?: Record<string, string>; logCount: number }) {
  console.log(`[field/sync-report] ${result.status} ${result.logCount}`);
  return NextResponse.json(result.body, {
    status: result.status,
    headers: {
      'Cache-Control': 'private, no-store',
      ...result.headers,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const result = await handleFieldSyncReportPost({
      authorization: request.headers.get('authorization'),
      rawBody,
      deps: deps(),
    });
    return json(result);
  } catch {
    console.log('[field/sync-report] 500 0');
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const result = await handleFieldSyncReportGet({
      authorization: request.headers.get('authorization'),
      searchParams: request.nextUrl.searchParams,
      deps: deps(),
    });
    return json(result);
  } catch {
    console.log('[field/sync-report] 500 0');
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
