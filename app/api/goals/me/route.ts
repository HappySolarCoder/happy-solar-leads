import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';

function getMonthParam(url: string) {
  const { searchParams } = new URL(url);
  return searchParams.get('month');
}

function getDocId(appUserId: string, month: string) {
  return `${appUserId}_${month.replace('-', '')}`;
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 401 });
    }

    const month = getMonthParam(request.url);
    if (!month) return NextResponse.json({ error: 'Missing month (YYYY-MM)' }, { status: 400 });

    const idToken = authHeader.split(' ')[1];
    const decoded = await adminAuth().verifyIdToken(idToken);

    // Resolve app user id from users/{authUid}
    const userDoc = await adminDb().collection('users').doc(decoded.uid).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const appUser = userDoc.data() as any;
    const appUserId = appUser?.id || appUser?.uid || decoded.uid;

    const goalDocId = getDocId(appUserId, month);
    const goalDoc = await adminDb().collection('userGoals').doc(goalDocId).get();

    if (!goalDoc.exists) {
      return NextResponse.json({ month, doorKnocksGoal: null, docId: goalDocId });
    }

    const goal = goalDoc.data() as any;

    return NextResponse.json({
      month,
      doorKnocksGoal: Number(goal?.doorKnocksGoal ?? 0),
      uid: goal?.uid,
      docId: goalDocId,
    });
  } catch (error: any) {
    console.error('[Goals Me] GET error:', error);
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 });
  }
}
