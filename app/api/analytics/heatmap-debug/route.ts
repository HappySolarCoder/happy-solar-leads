import { NextResponse } from 'next/server';
import { adminDb } from '@/app/utils/firebase-admin';

export const dynamic = 'force-dynamic';

function parseDate(value: any): string | null {
  if (!value) return null;
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function GET() {
  try {
    const db = adminDb();
    const snap = await db.collection('leads').limit(5).get();

    const sample = snap.docs.map((d) => {
      const lead: any = d.data();
      const history = Array.isArray(lead?.dispositionHistory) ? lead.dispositionHistory : [];
      return {
        id: d.id,
        status: lead?.status ?? null,
        disposition: lead?.disposition ?? null,
        dispositionedAt: parseDate(lead?.dispositionedAt),
        claimedBy: lead?.claimedBy ?? null,
        setterId: lead?.setterId ?? null,
        historyCount: history.length,
        historySample: history.slice(0, 2).map((h: any) => ({
          disposition: h?.disposition ?? null,
          userId: h?.userId ?? null,
          userName: h?.userName ?? null,
          timestamp: parseDate(h?.timestamp),
        })),
      };
    });

    return NextResponse.json({ ok: true, collection: 'leads', count: snap.size, sample });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
