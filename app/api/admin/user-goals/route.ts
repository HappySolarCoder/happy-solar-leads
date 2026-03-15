import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';

function getMonthParam(url: string) {
  const { searchParams } = new URL(url);
  return searchParams.get('month');
}

function getDocId(uid: string, month: string) {
  return `${uid}_${month.replace('-', '')}`;
}

async function assertAdmin(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Missing credentials'), { status: 401 });
  }
  const idToken = authHeader.split(' ')[1];
  const decoded = await adminAuth().verifyIdToken(idToken);
  const userDoc = await adminDb().collection('users').doc(decoded.uid).get();
  const userData = userDoc.data();
  if (!userDoc.exists || userData?.role !== 'admin') {
    throw Object.assign(new Error('Not authorized'), { status: 403 });
  }
  return { decoded };
}

export async function GET(request: NextRequest) {
  try {
    await assertAdmin(request);
    const month = getMonthParam(request.url);
    if (!month) return NextResponse.json({ error: 'Missing month (YYYY-MM)' }, { status: 400 });

    const snap = await adminDb().collection('userGoals').where('month', '==', month).get();
    const goals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ goals });
  } catch (err: any) {
    const status = err?.status || 500;
    console.error('[Admin User Goals] GET error:', err);
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { decoded } = await assertAdmin(request);
    const body = await request.json();
    const { month, goals } = body || {};

    if (!month || typeof month !== 'string') {
      return NextResponse.json({ error: 'Invalid month (YYYY-MM)' }, { status: 400 });
    }
    if (!Array.isArray(goals)) {
      return NextResponse.json({ error: 'Invalid goals payload' }, { status: 400 });
    }

    const batch = adminDb().batch();
    for (const g of goals) {
      if (!g?.uid || typeof g.uid !== 'string') continue;
      const doorKnocksGoal = Number(g.doorKnocksGoal || 0);
      const docId = getDocId(g.uid, month);
      const ref = adminDb().collection('userGoals').doc(docId);
      batch.set(ref, {
        uid: g.uid,
        month,
        doorKnocksGoal,
        updatedAt: new Date(),
        updatedBy: decoded.uid,
      }, { merge: true });
    }
    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (err: any) {
    const status = err?.status || 500;
    console.error('[Admin User Goals] POST error:', err);
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status });
  }
}
