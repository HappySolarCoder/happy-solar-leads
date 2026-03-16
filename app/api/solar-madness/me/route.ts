import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 401 });
    }

    const idToken = authHeader.split(' ')[1];
    const decoded = await adminAuth().verifyIdToken(idToken);

    const totalsDoc = await adminDb().collection('solarMadnessTotals').doc(decoded.uid).get();
    const totals = totalsDoc.exists ? totalsDoc.data() : null;

    const eventsSnap = await adminDb()
      .collection('solarMadnessEvents')
      .where('uid', '==', decoded.uid)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const events = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Bracket matchup snippet (v1): find current matchup window and compute points from events
    let matchup: any = null;
    const bracketDoc = await adminDb().collection('solarMadnessBracket').doc('current').get();
    if (bracketDoc.exists) {
      const bracket = bracketDoc.data() as any;
      const matchups = Array.isArray(bracket?.matchups) ? bracket.matchups : [];
      const now = new Date();
      const active = matchups.find((m: any) => {
        const s = m?.startsAt?.toDate ? m.startsAt.toDate() : new Date(m?.startsAt);
        const e = m?.endsAt?.toDate ? m.endsAt.toDate() : new Date(m?.endsAt);
        return (String(m?.aUid) === decoded.uid || String(m?.bUid) === decoded.uid) && s <= now && now <= e;
      });

      if (active) {
        const start = active?.startsAt?.toDate ? active.startsAt.toDate() : new Date(active.startsAt);
        const end = active?.endsAt?.toDate ? active.endsAt.toDate() : new Date(active.endsAt);

        const inWindow = events.filter((ev: any) => {
          const dt = ev?.createdAt?.toDate ? ev.createdAt.toDate() : new Date(ev?.createdAt);
          return dt >= start && dt <= end;
        });

        const myPoints = inWindow.reduce((s: number, ev: any) => s + Number(ev?.pointsAwarded || 0), 0);
        const opponentUid = String(active.aUid) === decoded.uid ? String(active.bUid) : String(active.aUid);

        // Opponent points: query events for opponent in window (simple; can be optimized later)
        const oppSnap = await adminDb()
          .collection('solarMadnessEvents')
          .where('uid', '==', opponentUid)
          .where('createdAt', '>=', start)
          .where('createdAt', '<=', end)
          .get();
        const oppPoints = oppSnap.docs.reduce((s, d) => s + Number((d.data() as any)?.pointsAwarded || 0), 0);

        matchup = {
          id: active.id,
          opponentUid,
          myPoints,
          opponentPoints: oppPoints,
          startsAt: start,
          endsAt: end,
        };
      }
    }

    return NextResponse.json({ totals, events, matchup });
  } catch (error: any) {
    console.error('[SolarMadness] me error:', error);
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 });
  }
}
