import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/app/utils/firebase-admin';

export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get('date') || '';
    // Expect YYYY-MM-DD in America/Phoenix context for now
    const [y, m, d] = date.split('-').map(Number);
    if (!y || !m || !d) {
      return NextResponse.json({ error: 'Pass ?date=YYYY-MM-DD' }, { status: 400 });
    }

    const start = new Date(y, m - 1, d, 0, 0, 0, 0);
    const end = new Date(y, m - 1, d, 23, 59, 59, 999);

    const snap = await adminDb()
      .collection('leads')
      .where('dispositionedAt', '>=', start)
      .where('dispositionedAt', '<=', end)
      .count()
      .get();

    return NextResponse.json({ date, knocks: snap.data().count, start, end });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 });
  }
}
