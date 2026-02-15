import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 401 });
    }

    const idToken = authHeader.split(' ')[1];
    const decoded = await adminAuth().verifyIdToken(idToken);

    const adminDoc = await adminDb().collection('users').doc(decoded.uid).get();
    if (!adminDoc.exists || adminDoc.data()?.role !== 'admin') {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const body = await request.json();
    const { userId } = body;
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    await adminAuth().deleteUser(userId);
    await adminDb().collection('users').doc(userId).delete();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Admin Delete User] error:', error);
    const message = error?.message || 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
