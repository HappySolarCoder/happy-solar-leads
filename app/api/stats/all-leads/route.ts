import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';

function serializeValue(value: any): any {
  if (value == null) return value;

  // Firestore Timestamp (admin SDK)
  if (typeof value?.toDate === 'function') {
    return value.toDate().toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = serializeValue(v);
    return out;
  }

  return value;
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 401 });
    }

    const idToken = authHeader.split(' ')[1];
    const decoded = await adminAuth().verifyIdToken(idToken);

    const meDoc = await adminDb().collection('users').doc(decoded.uid).get();
    const me = meDoc.data() as any;
    if (!meDoc.exists || !['admin', 'manager'].includes(String(me?.role || ''))) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const snap = await adminDb().collection('leads').get();
    const leads = snap.docs.map((d) => serializeValue({ id: d.id, ...(d.data() as any) }));

    return NextResponse.json({ leads });
  } catch (error: any) {
    console.error('[stats/all-leads] error:', error);
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 });
  }
}
