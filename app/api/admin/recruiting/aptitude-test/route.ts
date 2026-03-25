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

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const status = request.nextUrl.searchParams.get('status');
    const recommendation = request.nextUrl.searchParams.get('recommendation');

    const snapshot = await adminDb().collection('aptitudeTestSubmissions').orderBy('submittedAt', 'desc').get();
    let submissions = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }));
    if (status) submissions = submissions.filter((row) => row.status === status);
    if (recommendation) submissions = submissions.filter((row) => row.recommendation === recommendation);

    return NextResponse.json({ submissions: serialize(submissions) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: error?.status || 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const created = await adminDb().collection('aptitudeTestSubmissions').add({
      ...body,
      submittedAt: new Date(),
      status: body?.status || 'new',
    });
    return NextResponse.json({ success: true, id: created.id });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 });
  }
}
