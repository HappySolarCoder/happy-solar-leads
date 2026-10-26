import { NextRequest, NextResponse } from 'next/server';
import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Query,
  type UpdateData,
} from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import {
  FIELD_DISPO_MAX_BYTES,
  handleFieldDispo,
  type DispoCollection,
  type DispoDb,
  type DispoDocRef,
  type DispoFilter,
  type DispoQuery,
  type DispoSnap,
  type DispoTransaction,
  type FieldDispoResult,
} from '@/app/utils/server/fieldDispo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const queryNatives = new WeakMap<DispoQuery, Query>();
const docNatives = new WeakMap<DispoDocRef, DocumentReference>();

function snapOf(snap: { exists: boolean; id: string; data: () => DocumentData | undefined }): DispoSnap {
  return {
    exists: snap.exists,
    id: snap.id,
    data: () => snap.data() as Record<string, unknown> | undefined,
  };
}

function asQuery(name: string, native: Query, filters: readonly DispoFilter[], limitCount: number | null): DispoQuery {
  const query: DispoQuery = {
    kind: 'query',
    collectionName: name,
    filters,
    limitCount,
    limit(n: number) {
      return asQuery(name, native.limit(n), filters, n);
    },
  };
  queryNatives.set(query, native);
  return query;
}

function asDoc(ref: DocumentReference): DispoDocRef {
  const doc: DispoDocRef = {
    id: ref.id,
    path: ref.path,
    async get() {
      return snapOf(await ref.get());
    },
  };
  docNatives.set(doc, ref);
  return doc;
}

function adaptDb(db: Firestore): DispoDb {
  return {
    collection(name: string): DispoCollection {
      const col = db.collection(name);
      return {
        name,
        doc(id: string) {
          return asDoc(col.doc(id));
        },
        where(field: string, op: string, value: string) {
          const native = col.where(field, op as FirebaseFirestore.WhereFilterOp, value);
          return asQuery(name, native, [{ field, op, value }], null);
        },
      };
    },
    runTransaction(fn) {
      return db.runTransaction(async (tx) => {
        const adapted: DispoTransaction = {
          async get(ref) {
            const native = docNatives.get(ref);
            if (!native) throw new Error('Dispo document ref is not bound');
            return snapOf(await tx.get(native));
          },
          async getQuery(query) {
            const native = queryNatives.get(query);
            if (!native) throw new Error('Dispo query is not bound');
            const snap = await tx.get(native);
            return {
              docs: snap.docs.map((doc) => ({
                exists: doc.exists,
                id: doc.id,
                data: () => doc.data() as Record<string, unknown>,
              })),
            };
          },
          update(ref, data) {
            const native = docNatives.get(ref);
            if (!native) throw new Error('Dispo document ref is not bound');
            tx.update(native, data as UpdateData<DocumentData>);
          },
          create(ref, data) {
            const native = docNatives.get(ref);
            if (!native) throw new Error('Dispo document ref is not bound');
            tx.create(native, data);
          },
        };
        return fn(adapted);
      });
    },
  };
}

function deps() {
  const db = adminDb();
  return {
    verifyIdToken: (token: string, checkRevoked: true) => adminAuth().verifyIdToken(token, checkRevoked),
    getUser: async (uid: string) => {
      const doc = await db.collection('users').doc(uid).get();
      return { exists: doc.exists, data: doc.data() };
    },
    db: adaptDb(db),
    Timestamp,
    serverTimestamp: () => FieldValue.serverTimestamp(),
  };
}

function json(result: FieldDispoResult) {
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
    const authorization = request.headers.get('authorization');
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > FIELD_DISPO_MAX_BYTES) {
      return json(await handleFieldDispo({ authorization, bodyBytes: declared, deps: deps() }));
    }
    const rawBody = await request.text();
    return json(await handleFieldDispo({ authorization, rawBody, deps: deps() }));
  } catch {
    console.log('[field/dispo] 500 internal');
    return NextResponse.json(
      { ok: false, error: 'internal' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
