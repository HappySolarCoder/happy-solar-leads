import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { handleFieldKnockEventsGet, ownEventsQuery, staffEventsQuery } from '@/app/utils/server/fieldKnockEventsRead';

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
          const snap = await staffEventsQuery<FirebaseFirestore.Query>(
            db.collection('fieldKnockEvents') as never,
            Timestamp.fromMillis(sinceMs),
            SELECT,
            limit,
          ).get();
          return snap.docs.map((d) => d.data());
        },
        loadOwn: async (uid, limit, sinceMs) => {
          if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return [];
          try {
            const snap = await ownEventsQuery<FirebaseFirestore.Query>(
              db.collection('fieldKnockEvents') as never,
              uid,
              Timestamp.fromMillis(sinceMs),
              SELECT,
              limit,
            ).get();
            return snap.docs.map((d) => d.data());
          } catch (error) {
            // Fail open (e.g. the composite index is not deployed yet): the rep's counters fall back to history only.
            console.error('[field-knock-events] own read failed:', error instanceof Error ? error.message.slice(0, 160) : '');
            return [];
          }
        },
      },
    });
    return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[field-knock-events] error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
