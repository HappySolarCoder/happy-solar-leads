import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { getGhlOpportunitiesAsync } from '@/app/utils/ghl-firestore';

function norm(v: any) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getStageOutcomes() {
  try {
    const raw = process.env.STAGE_OUTCOMES;
    if (!raw) return DEFAULT_STAGE_OUTCOMES;
    return { ...DEFAULT_STAGE_OUTCOMES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_STAGE_OUTCOMES;
  }
}

function normalizeOutcomeFromOpportunity(o: any) {
  const map = getStageOutcomes();
  const stageId = String(o.pipelineStageId || o.stageId || '').trim();
  const stageName = String(o.stage || o.pipelineStage || o.status || o.outcome || '').trim();
  const keyById = norm(stageId);
  const keyByName = norm(stageName);
  return map[keyById] || map[keyByName] || stageName || null;
}

const STATUS_DOC = 'appointments-sync-status';
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_STAGE_OUTCOMES: Record<string, string> = {
  show: 'Show',
  showed: 'Show',
  no_show: 'No Show',
  noshow: 'No Show',
  no_showed: 'No Show',
  sold: 'Sold',
  closed_won: 'Sold',
  won: 'Sold',
  closed_lost: 'Lost',
  lost: 'Lost',
  rescheduled: 'Rescheduled',
  reschedule: 'Rescheduled',
};

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
    let skippedAmbiguous = 0;
    const auditRows: any[] = [];

    for (const o of opps) {
      const matches = [
        o.phone ? byPhone.get(norm(o.phone)) : null,
        o.email ? byEmail.get(norm(o.email)) : null,
        o.name ? byName.get(norm(o.name)) : null,
      ].filter(Boolean);

      const uniqueIds = Array.from(new Set(matches.map((m: any) => m.id)));
      if (uniqueIds.length !== 1) {
        if (uniqueIds.length > 1) skippedAmbiguous++;
        continue;
      }

      const lead = matches[0] as any;
      if (!lead) continue;
      matched++;

      const normalizedOutcome = normalizeOutcomeFromOpportunity(o);
      const patch: any = {
        ghlStatus: o.status || o.stage || o.pipelineStage || null,
        appointmentOutcome: normalizedOutcome,
        ghlOpportunityId: o.opportunityId || o.id || null,
        ghlLastUpdatedAt: o.updatedAt?.toDate ? o.updatedAt.toDate() : (o.updatedAt ? new Date(o.updatedAt) : new Date()),
      };

      const appt = o.appointmentDateTime || o.startTime || o.appointmentTime;
      if (appt) {
        patch.appointmentDateTime = appt?.toDate ? appt.toDate() : new Date(appt);
      }

      batch.update(adminDb().collection('leads').doc(lead.id), patch);
      updated++;
      auditRows.push({
        leadId: lead.id,
        opportunityId: o.opportunityId || o.id || null,
        matchedBy: o.phone ? 'phone' : o.email ? 'email' : o.name ? 'name' : 'unknown',
        outcome: normalizedOutcome,
        syncedAt: new Date(),
      });
    }

    if (updated > 0) await batch.commit();

    if (auditRows.length > 0) {
      const auditBatch = adminDb().batch();
      auditRows.slice(0, 500).forEach((row) => {
        const ref = adminDb().collection('appointments_sync_audit').doc();
        auditBatch.set(ref, row);
      });
      await auditBatch.commit();
    }

    await statusRef.set({
      state: 'idle',
      lastSuccessAt: new Date(),
      matched,
      updated,
      skippedAmbiguous,
      lastError: null,
    }, { merge: true });

    return NextResponse.json({ success: true, matched, updated, skippedAmbiguous });
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
