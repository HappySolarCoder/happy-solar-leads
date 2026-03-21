import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { getGhlOpportunitiesAsync } from '@/app/utils/ghl-firestore';

function norm(v: any) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const STATUS_DOC = 'appointments-sync-status';
const MIN_INTERVAL_MS = 5 * 60 * 1000;

async function requireManager(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing credentials');
  }

  const idToken = authHeader.split(' ')[1];
  const decoded = await adminAuth().verifyIdToken(idToken);
  const meDoc = await adminDb().collection('users').doc(decoded.uid).get();
  const me = meDoc.data() as any;
  if (!meDoc.exists || !['admin', 'manager'].includes(String(me?.role || ''))) {
    throw new Error('Not authorized');
  }
  return decoded.uid;
}

export async function GET(request: NextRequest) {
  try {
    await requireManager(request);
    const doc = await adminDb().collection('system').doc(STATUS_DOC).get();
    return NextResponse.json({ status: doc.exists ? doc.data() : null });
  } catch (error: any) {
    const status = /authorized/i.test(String(error?.message)) ? 403 : /credentials/i.test(String(error?.message)) ? 401 : 500;
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      return NextResponse.json({ error: 'ghl-not-configured' }, { status: 503 });
    }

    const actorUid = await requireManager(request);

    const statusRef = adminDb().collection('system').doc(STATUS_DOC);
    const statusSnap = await statusRef.get();
    const lastStartedAt = statusSnap.exists ? (statusSnap.data() as any)?.startedAt : null;
    const lastStart = lastStartedAt?.toDate ? lastStartedAt.toDate().getTime() : lastStartedAt ? new Date(lastStartedAt).getTime() : 0;
    if (Date.now() - lastStart < MIN_INTERVAL_MS) {
      return NextResponse.json({ error: 'sync-cooldown', retryAfterMs: MIN_INTERVAL_MS - (Date.now() - lastStart) }, { status: 429 });
    }

    await statusRef.set({
      state: 'running',
      startedAt: new Date(),
      startedBy: actorUid,
      lastError: null,
    }, { merge: true });

    const [opps, leadsSnap] = await Promise.all([
      getGhlOpportunitiesAsync(),
      adminDb().collection('leads').get(),
    ]);

    const leads = leadsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

    const byPhone = new Map<string, any>();
    const byEmail = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const l of leads) {
      if (l.phone) byPhone.set(norm(l.phone), l);
      if (l.email) byEmail.set(norm(l.email), l);
      if (l.name) byName.set(norm(l.name), l);
    }

    const batch = adminDb().batch();
    let matched = 0;
    let updated = 0;

    for (const o of opps) {
      const lead = (o.phone && byPhone.get(norm(o.phone)))
        || (o.email && byEmail.get(norm(o.email)))
        || (o.name && byName.get(norm(o.name)));
      if (!lead) continue;
      matched++;

      const patch: any = {
        ghlStatus: o.status || o.stage || o.pipelineStage || null,
        appointmentOutcome: o.outcome || o.status || o.stage || null,
        ghlOpportunityId: o.opportunityId || o.id || null,
        ghlLastUpdatedAt: o.updatedAt?.toDate ? o.updatedAt.toDate() : (o.updatedAt ? new Date(o.updatedAt) : new Date()),
      };

      const appt = o.appointmentDateTime || o.startTime || o.appointmentTime;
      if (appt) {
        patch.appointmentDateTime = appt?.toDate ? appt.toDate() : new Date(appt);
      }

      batch.update(adminDb().collection('leads').doc(lead.id), patch);
      updated++;
    }

    if (updated > 0) await batch.commit();

    await statusRef.set({
      state: 'idle',
      lastSuccessAt: new Date(),
      matched,
      updated,
      lastError: null,
    }, { merge: true });

    return NextResponse.json({ success: true, matched, updated });
  } catch (error: any) {
    console.error('[admin/sync-appointments] error:', error);
    try {
      await adminDb().collection('system').doc(STATUS_DOC).set({
        state: 'error',
        lastError: error?.message || 'Internal error',
        lastFailureAt: new Date(),
      }, { merge: true });
    } catch {}
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 });
  }
}
