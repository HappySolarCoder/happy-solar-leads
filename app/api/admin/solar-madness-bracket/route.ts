import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';

const DOC_ID = 'current';

async function requireAdmin(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Missing credentials' }, { status: 401 }) };
  }

  const idToken = authHeader.split(' ')[1];
  const decoded = await adminAuth().verifyIdToken(idToken);
  const userDoc = await adminDb().collection('users').doc(decoded.uid).get();
  const userData = userDoc.data();
  if (!userDoc.exists || userData?.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) };
  }

  return { decoded };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const doc = await adminDb().collection('solarMadnessBracket').doc(DOC_ID).get();
    return NextResponse.json({ bracket: doc.exists ? doc.data() : null });
  } catch (error: any) {
    console.error('[SolarMadnessBracket] GET error:', error);
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const bracket = body?.bracket;
    if (!bracket || typeof bracket !== 'object') {
      return NextResponse.json({ error: 'Invalid bracket' }, { status: 400 });
    }

    await adminDb().collection('solarMadnessBracket').doc(DOC_ID).set({
      ...bracket,
      updatedAt: new Date(),
      updatedBy: auth.decoded!.uid,
    }, { merge: true });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[SolarMadnessBracket] POST error:', error);
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 });
  }
}
