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

    return NextResponse.json({ totals, events });
  } catch (error: any) {
    console.error('[SolarMadness] me error:', error);
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 });
  }
}
