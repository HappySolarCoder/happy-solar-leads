import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';

function norm(v: any) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function POST(request: NextRequest) {
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

    // Phase 4 guard: never break when GHL env is not configured.
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      return NextResponse.json({ error: 'ghl-not-configured' }, { status: 503 });
    }

    // Expected mirror collection shape (flexible):
    // { raydarLeadId?, address?, phone?, appointmentDateTime?, status?, outcome?, opportunityId?, updatedAt? }
    const mirrorSnap = await adminDb().collection('ghl_appointments').limit(5000).get();

    if (mirrorSnap.empty) {
      return NextResponse.json({ success: true, matched: 0, updated: 0, message: 'No GHL mirror records found.' });
    }

    const leadsSnap = await adminDb().collection('leads').get();
    const leads = leadsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

    const byId = new Map(leads.map((l) => [String(l.id), l]));
    const byAddress = new Map<string, any>();
    const byPhone = new Map<string, any>();

    for (const l of leads) {
      if (l.address) byAddress.set(norm(l.address), l);
      if (l.phone) byPhone.set(norm(l.phone), l);
    }

    const batch = adminDb().batch();
    let matched = 0;
    let updated = 0;

    for (const doc of mirrorSnap.docs) {
      const m = doc.data() as any;
      const lead = (m.raydarLeadId && byId.get(String(m.raydarLeadId)))
        || (m.address && byAddress.get(norm(m.address)))
        || (m.phone && byPhone.get(norm(m.phone)));

      if (!lead) continue;
      matched++;

      const patch: any = {
        ghlStatus: m.status || m.ghlStatus || null,
        appointmentOutcome: m.outcome || m.appointmentOutcome || null,
        ghlOpportunityId: m.opportunityId || m.ghlOpportunityId || null,
        ghlLastUpdatedAt: m.updatedAt?.toDate ? m.updatedAt.toDate() : (m.updatedAt ? new Date(m.updatedAt) : new Date()),
      };

      if (m.appointmentDateTime) {
        patch.appointmentDateTime = m.appointmentDateTime?.toDate
          ? m.appointmentDateTime.toDate()
          : new Date(m.appointmentDateTime);
      }

      batch.update(adminDb().collection('leads').doc(lead.id), patch);
      updated++;
    }

    if (updated > 0) await batch.commit();

    return NextResponse.json({ success: true, matched, updated });
  } catch (error: any) {
    console.error('[appointments/sync] error:', error);
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 });
  }
}
