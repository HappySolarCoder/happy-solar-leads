import { NextRequest, NextResponse } from 'next/server';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { handleFieldKnockEventsGet } from '@/app/utils/server/fieldKnockEventsRead';

export const runtime = 'nodejs';

const SELECT = ['uid', 'leadId', 'actionAt', 'dispositionId', 'status', 'disposition'] as const;

export async function GET(request: NextRequest) {
  try {
    const db = adminDb();
    const result = await handleFieldKnockEventsGet({
      authorization: request.headers.get('authorization'),
      sinceParam: request.nextUrl.searchParams.get('since'),
      deps: {
        verifyIdToken: (token, checkRevoked) => adminAuth().verifyIdToken(token, checkRevoked),
        getUser: async (uid) => {
          const doc = await db.collection('users').doc(uid).get();
          return { exists: doc.exists, data: doc.data() };
        },
        loadSince: async (sinceMs, limit) => {
          const snap = await db
            .collection('fieldKnockEvents')
            .where('actionAt', '>=', Timestamp.fromMillis(sinceMs))
            .orderBy('actionAt')
            .select(...SELECT)
            .limit(limit)
            .get();
          return snap.docs.map((d) => d.data());
        },
        loadOwn: async (uid, limit) => {
          if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return [];
          const snap = await db
            .collection('fieldKnockEvents')
            .orderBy(FieldPath.documentId())
            .startAt(`${uid}_`)
            .endAt(`${uid}_\uf8ff`)
            .select(...SELECT)
            .limit(limit)
            .get();
          return snap.docs.map((d) => d.data());
        },
      },
    });
    return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[field-knock-events] error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
