/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import {
  getGhlContactsAsync,
  getGhlOpportunitiesAsync,
  getGhlPipelinesAsync,
  normalizePhoneToLast10,
} from '@/app/utils/ghl-firestore';

const STATUS_DOC = 'appointments-sync-status';
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const APPOINTMENT_OUTCOME_CUSTOM_FIELD_ID = 'GYGpLKBPfMpiBqyU2ogQ';
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

function norm(v: unknown) {
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

function pickTimestamp(value: any): number {
  if (!value) return 0;
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateOrNull(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getFieldString(value: any): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function getOpportunityCustomField(opportunity: any, fieldId: string): string | null {
  const customFields = Array.isArray(opportunity?.customFields) ? opportunity.customFields : [];
  const match = customFields.find((field: any) => String(field?.id || field?.fieldId || '').trim() === fieldId);
  return getFieldString(
    match?.fieldValueString
      ?? match?.value
      ?? match?.fieldValue
      ?? match?.stringValue
  );
}

function buildPipelineStageNameMap(pipelines: any[]) {
  const stageNameById = new Map<string, string>();

  for (const pipeline of pipelines) {
    const stages = [
      ...(Array.isArray(pipeline?.stages) ? pipeline.stages : []),
      ...(Array.isArray(pipeline?.pipelineStages) ? pipeline.pipelineStages : []),
    ];

    for (const stage of stages) {
      const id = getFieldString(stage?.id || stage?.stageId);
      const name = getFieldString(stage?.name || stage?.label || stage?.title);
      if (id && name && !stageNameById.has(id)) {
        stageNameById.set(id, name);
      }
    }
  }

  return stageNameById;
}

function normalizeOutcomeFromOpportunity(opportunity: any, stageNameById: Map<string, string>) {
  const map = getStageOutcomes();
  const customOutcome = getOpportunityCustomField(opportunity, APPOINTMENT_OUTCOME_CUSTOM_FIELD_ID);
  if (customOutcome) return customOutcome;

  const stageId = getFieldString(opportunity?.pipelineStageId || opportunity?.stageId);
  const stageName = getFieldString(
    opportunity?.stage
      || opportunity?.pipelineStage
      || (stageId ? stageNameById.get(stageId) : null)
      || opportunity?.status
      || opportunity?.outcome
  );

  const keyById = norm(stageId);
  const keyByName = norm(stageName);
  return map[keyById] || map[keyByName] || stageName || null;
}

function pickMostRecentOpportunity(opportunities: any[]) {
  return [...opportunities].sort((a, b) => {
    const aUpdated = pickTimestamp(a?.updatedAt);
    const bUpdated = pickTimestamp(b?.updatedAt);
    if (bUpdated !== aUpdated) return bUpdated - aUpdated;
    const aCreated = pickTimestamp(a?.createdAt);
    const bCreated = pickTimestamp(b?.createdAt);
    return bCreated - aCreated;
  })[0] || null;
}

function withNullSafePatch(lead: any, patch: Record<string, any>) {
  const safePatch: Record<string, any> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null && value !== undefined) {
      safePatch[key] = value;
      continue;
    }

    const existing = lead?.[key];
    const hasExisting = existing !== null && existing !== undefined && String(existing).trim() !== '';
    if (!hasExisting) {
      safePatch[key] = value;
    }
  }
  return safePatch;
}

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

    const [contacts, opportunities, pipelines, leadsSnap] = await Promise.all([
      getGhlContactsAsync(),
      getGhlOpportunitiesAsync(),
      getGhlPipelinesAsync().catch(() => []),
      adminDb().collection('leads').get(),
    ]);

    const leads = leadsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    const stageNameById = buildPipelineStageNameMap(pipelines);

    const contactsByPhone = new Map<string, any[]>();
    for (const contact of contacts) {
      const phoneKey = normalizePhoneToLast10(contact?.phone);
      if (!phoneKey) continue;
      const current = contactsByPhone.get(phoneKey) || [];
      current.push(contact);
      contactsByPhone.set(phoneKey, current);
    }

    const opportunitiesByContactId = new Map<string, any[]>();
    for (const opportunity of opportunities) {
      const contactId = getFieldString(opportunity?.contactId);
      if (!contactId) continue;
      const current = opportunitiesByContactId.get(contactId) || [];
      current.push(opportunity);
      opportunitiesByContactId.set(contactId, current);
    }

    let matched = 0;
    let updated = 0;
    let skippedAmbiguous = 0;
    let unmatched = 0;
    const auditRows: any[] = [];
    const batch = adminDb().batch();

    for (const lead of leads) {
      const phoneKey = normalizePhoneToLast10(lead?.phone);
      if (!phoneKey) {
        unmatched++;
        auditRows.push({
          leadId: lead.id,
          phone: null,
          result: 'unmatched',
          reason: 'missing-raydar-phone',
          syncedAt: new Date(),
        });
        continue;
      }

      const matchedContacts = contactsByPhone.get(phoneKey) || [];
      if (matchedContacts.length !== 1) {
        if (matchedContacts.length > 1) skippedAmbiguous++;
        else unmatched++;

        auditRows.push({
          leadId: lead.id,
          phone: phoneKey,
          result: matchedContacts.length > 1 ? 'ambiguous' : 'unmatched',
          reason: matchedContacts.length > 1 ? 'multiple-ghl-contacts-for-phone' : 'no-ghl-contact-for-phone',
          contactIds: matchedContacts.map((contact) => contact.id),
          syncedAt: new Date(),
        });
        continue;
      }

      const contact = matchedContacts[0];
      const contactId = getFieldString(contact?.id) || String(contact.id);
      const matchedOpportunities = opportunitiesByContactId.get(contactId) || [];
      const opportunity = pickMostRecentOpportunity(matchedOpportunities);

      if (!opportunity) {
        unmatched++;
        auditRows.push({
          leadId: lead.id,
          phone: phoneKey,
          result: 'unmatched',
          reason: 'no-ghl-opportunity-for-contact',
          contactId,
          syncedAt: new Date(),
        });
        continue;
      }

      matched++;

      const pipelineStageId = getFieldString(opportunity?.pipelineStageId || opportunity?.stageId);
      const ghlStatus = getFieldString(
        opportunity?.stage
          || opportunity?.pipelineStage
          || (pipelineStageId ? stageNameById.get(pipelineStageId) : null)
          || opportunity?.status
      );
      const appointmentDateTime = toDateOrNull(opportunity?.appointmentOccurredAt || opportunity?.appointmentDateTime || opportunity?.startTime || opportunity?.appointmentTime);
      const appointmentOutcome = normalizeOutcomeFromOpportunity(opportunity, stageNameById);
      const patch = withNullSafePatch(lead, {
        appointmentDateTime,
        pipelineStageId,
        appointmentOutcome,
        ghlOpportunityId: getFieldString(opportunity?.id || opportunity?.opportunityId),
        ghlContactId: contactId,
        ghlStatus,
        dispositionNotes: getFieldString(
          opportunity?.dispositionNotes
            || opportunity?.notes
            || opportunity?.note
            || opportunity?.internalNotes
        ),
        ghlLastUpdatedAt: toDateOrNull(opportunity?.updatedAt) || new Date(),
      });

      if (Object.keys(patch).length === 0) continue;

      batch.set(adminDb().collection('leads').doc(lead.id), patch, { merge: true });
      updated++;

      auditRows.push({
        leadId: lead.id,
        phone: phoneKey,
        contactId,
        opportunityId: getFieldString(opportunity?.id || opportunity?.opportunityId),
        result: 'updated',
        matchedBy: 'phone',
        outcome: appointmentOutcome,
        pipelineStageId,
        syncedAt: new Date(),
      });
    }

    if (updated > 0) {
      await batch.commit();
    }

    if (auditRows.length > 0) {
      const chunks: any[][] = [];
      for (let i = 0; i < auditRows.length; i += 500) {
        chunks.push(auditRows.slice(i, i + 500));
      }

      for (const rows of chunks) {
        const auditBatch = adminDb().batch();
        rows.forEach((row) => {
          const ref = adminDb().collection('appointments_sync_audit').doc();
          auditBatch.set(ref, row);
        });
        await auditBatch.commit();
      }
    }

    await statusRef.set({
      state: 'idle',
      lastSuccessAt: new Date(),
      matched,
      updated,
      unmatched,
      skippedAmbiguous,
      lastError: null,
    }, { merge: true });

    return NextResponse.json({ success: true, matched, updated, unmatched, skippedAmbiguous });
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
