import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 401 });
    }

    const idToken = authHeader.split(' ')[1];
    await adminAuth().verifyIdToken(idToken);

    const cfgDoc = await adminDb().collection('solarMadnessConfig').doc('current').get();
    const seasonName = cfgDoc.exists ? String((cfgDoc.data() as any)?.seasonName || 'Solar Madness') : 'Solar Madness';

    const bracketDoc = await adminDb().collection('solarMadnessBracket').doc('current').get();
    if (!bracketDoc.exists) {
      return NextResponse.json({ seasonName, bracket: null });
    }

    return NextResponse.json({ seasonName, bracket: { id: bracketDoc.id, ...bracketDoc.data() } });
  } catch (error: any) {
    console.error('[SolarMadness] bracket error:', error);
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 });
  }
}
