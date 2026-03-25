import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';

async function requireAdmin(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) throw Object.assign(new Error('Missing credentials'), { status: 401 });
  const decoded = await adminAuth().verifyIdToken(authHeader.split(' ')[1]);
  const userDoc = await adminDb().collection('users').doc(decoded.uid).get();
  const user = userDoc.data();
  if (!userDoc.exists || !['admin', 'manager'].includes(String(user?.role || ''))) {
    throw Object.assign(new Error('Not authorized'), { status: 403 });
  }
  return decoded.uid;
}

function serialize(value: any): any {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  return value;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ submissionId: string }> }) {
  try {
    await requireAdmin(request);
    const { submissionId } = await params;
    const doc = await adminDb().collection('aptitudeTestSubmissions').doc(submissionId).get();
    if (!doc.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ submission: serialize({ id: doc.id, ...(doc.data() as any) }) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: error?.status || 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ submissionId: string }> }) {
  try {
    const reviewerUid = await requireAdmin(request);
    const { submissionId } = await params;
    const body = await request.json();
    await adminDb().collection('aptitudeTestSubmissions').doc(submissionId).set({
      status: body?.status,
      notes: body?.notes || '',
      reviewedBy: reviewerUid,
      reviewedAt: new Date(),
    }, { merge: true });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: error?.status || 500 });
  }
}
