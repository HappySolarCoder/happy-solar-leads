import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { toPublicAdminSettings } from '@/app/utils/publicAdminSettings';

const SETTINGS_DOC_ID = 'global';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 401 });
    }

    const idToken = authHeader.split(' ')[1];
    const decoded = await adminAuth().verifyIdToken(idToken);

    const userDoc = await adminDb().collection('users').doc(decoded.uid).get();
    const userData = userDoc.data();
    if (!userDoc.exists || userData?.role !== 'admin') {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const docSnap = await adminDb().collection('adminSettings').doc(SETTINGS_DOC_ID).get();
    const settings = docSnap.exists ? toPublicAdminSettings(docSnap.data()) : null;
    return NextResponse.json({ settings });
  } catch (error: unknown) {
    console.error('[Admin Settings] GET error');
    const message = error instanceof Error ? error.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 401 });
    }

    const idToken = authHeader.split(' ')[1];
    const decoded = await adminAuth().verifyIdToken(idToken);

    const adminDoc = await adminDb().collection('users').doc(decoded.uid).get();
    const adminData = adminDoc.data();
    if (!adminDoc.exists || adminData?.role !== 'admin') {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const body = await request.json();
    const { schedulingManagerPhone, notificationType } = body || {};

    if (!schedulingManagerPhone || typeof schedulingManagerPhone !== 'string') {
      return NextResponse.json({ error: 'Invalid schedulingManagerPhone' }, { status: 400 });
    }
    if (!['discord', 'googlechat', 'slack', 'webhook'].includes(notificationType)) {
      return NextResponse.json({ error: 'Invalid notificationType' }, { status: 400 });
    }

    // Phone and platform only. The webhook stays in Firestore until the server
    // env var replaces it, and this response never echoes it.
    const settings = {
      schedulingManagerPhone,
      notificationType,
      updatedAt: new Date(),
      updatedBy: decoded.uid,
    };

    await adminDb().collection('adminSettings').doc(SETTINGS_DOC_ID).set(settings, { merge: true });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[Admin Settings] POST error');
    const message = error instanceof Error ? error.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
