import { NextResponse } from 'next/server';
import { adminDb } from '@/app/utils/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const uid = searchParams.get('uid');
    const south = Number(searchParams.get('south') ?? '43.15');
    const north = Number(searchParams.get('north') ?? '43.30');

    if (!uid) return NextResponse.json({ ok: false, error: 'Missing uid' }, { status: 400 });

    const db = adminDb();

    // This mimics the map query pattern that reps use (assignedTo/claimedBy + lat range)
    const q1 = db
      .collection('leads')
      .where('assignedTo', '==', uid)
      .where('lat', '>=', south)
      .where('lat', '<=', north)
      .limit(5);

    const q2 = db
      .collection('leads')
      .where('claimedBy', '==', uid)
      .where('lat', '>=', south)
      .where('lat', '<=', north)
      .limit(5);

    const [s1, s2] = await Promise.all([q1.get(), q2.get()]);

    return NextResponse.json({
      ok: true,
      uid,
      bounds: { south, north },
      counts: { assignedInLatRange: s1.size, claimedInLatRange: s2.size },
      sampleIds: {
        assigned: s1.docs.map((d) => d.id),
        claimed: s2.docs.map((d) => d.id),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
