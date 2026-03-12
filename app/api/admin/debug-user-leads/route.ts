import { NextResponse } from 'next/server';
import { adminDb } from '@/app/utils/firebase-admin';

export const dynamic = 'force-dynamic';

function mapLead(doc: any) {
  const d = doc.data() as any;
  return {
    id: doc.id,
    lat: d.lat ?? null,
    lng: d.lng ?? null,
    address: d.address ?? null,
    city: d.city ?? null,
    state: d.state ?? null,
    zip: d.zip ?? null,
    status: d.status ?? null,
    assignedTo: d.assignedTo ?? null,
    claimedBy: d.claimedBy ?? null,
    assignedAt: d.assignedAt?.toDate ? d.assignedAt.toDate().toISOString() : (d.assignedAt ?? null),
    claimedAt: d.claimedAt?.toDate ? d.claimedAt.toDate().toISOString() : (d.claimedAt ?? null),
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const uid = searchParams.get('uid');
    if (!uid) return NextResponse.json({ ok: false, error: 'Missing uid' }, { status: 400 });

    const db = adminDb();

    const [assignedSnap, claimedSnap] = await Promise.all([
      db.collection('leads').where('assignedTo', '==', uid).limit(50).get(),
      db.collection('leads').where('claimedBy', '==', uid).limit(50).get(),
    ]);

    const assigned = assignedSnap.docs.map(mapLead);
    const claimed = claimedSnap.docs.map(mapLead);

    const assignedMissingGeo = assigned.filter((l) => l.lat == null || l.lng == null).length;
    const claimedMissingGeo = claimed.filter((l) => l.lat == null || l.lng == null).length;

    return NextResponse.json({
      ok: true,
      uid,
      counts: {
        assignedTo: assignedSnap.size,
        claimedBy: claimedSnap.size,
        assignedMissingGeo,
        claimedMissingGeo,
      },
      samples: {
        assignedTo: assigned.slice(0, 10),
        claimedBy: claimed.slice(0, 10),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
