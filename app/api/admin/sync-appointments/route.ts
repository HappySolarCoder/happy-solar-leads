/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import {
  getGhlAppointmentEventsAsync,
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

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === 'function') {
    const converted = value.toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
  }

  if (typeof value === 'object') {
    if (typeof value.seconds === 'number') {
      const millis = value.seconds * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1_000_000);
      const converted = new Date(millis);
      return Number.isNaN(converted.getTime()) ? null : converted;
    }

    if (typeof value._seconds === 'number') {
      const millis = value._seconds * 1000 + Math.floor(Number(value._nanoseconds || 0) / 1_000_000);
      const converted = new Date(millis);
      return Number.isNaN(converted.getTime()) ? null : converted;
    }

    const datePart = getFieldString(value.date || value.appointmentDate || value.startDate);
    const timePart = getFieldString(value.time || value.appointmentTime || value.startTime);
    if (datePart && timePart) {
      const combined = new Date(`${datePart} ${timePart}`);
      if (!Number.isNaN(combined.getTime())) return combined;
      const isoCombined = new Date(`${datePart}T${timePart}`);
      if (!Number.isNaN(isoCombined.getTime())) return isoCombined;
    }

    const isoLike = getFieldString(value.iso || value.isoString || value.datetime || value.dateTime || value.value);
    if (isoLike) {
      const converted = new Date(isoLike);
      return Number.isNaN(converted.getTime()) ? null : converted;
    }
  }

  if (typeof value === 'number') {
    const millis = value > 1e12 ? value : value * 1000;
    const converted = new Date(millis);
    return Number.isNaN(converted.getTime()) ? null : converted;
  }

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

function getContactPhoneKeys(contact: any): string[] {
  const candidates = [
    contact?.phone,
    contact?.mobile,
    contact?.phoneNumber,
    contact?.contact?.phone,
    contact?.contact?.phoneNumber,
  ];

  const keys = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizePhoneToLast10(candidate);
    if (normalized) keys.add(normalized);
  }
  return Array.from(keys);
}

function getOpportunityContactId(opportunity: any): string | null {
  return getFieldString(
    opportunity?.contactId
      || opportunity?.contact?.id
      || opportunity?.contact?._id
      || opportunity?.contact?.contactId
  );
}

function collectPossibleRelationIds(value: any): string[] {
  const results = new Set<string>();

  const visit = (input: any) => {
    if (!input) return;

    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }

    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (trimmed) results.add(trimmed);
      return;
    }

    if (typeof input === 'object') {
      const directId = getFieldString(
        input.id
        || input._id
        || input.eventId
        || input.appointmentId
        || input.calendarEventId
        || input.relatedId
        || input.entityId
      );
      if (directId) results.add(directId);

      const nestedCandidates = [
        input.relations,
        input.related,
        input.events,
        input.appointments,
        input.calendarEvents,
        input.links,
      ];
      nestedCandidates.forEach(visit);
    }
  };

  visit(value);
  return Array.from(results);
}

function buildEventStartIndex(events: any[]) {
  const byId = new Map<string, Date>();
  const byOpportunityId = new Map<string, Date>();
  const byContactId = new Map<string, Date>();

  for (const event of events) {
    const start = toDateOrNull(
      event?.startTime
      || event?.start
      || event?.startAt
      || event?.startDateTime
      || event?.appointmentDateTime
      || event?.appointmentStartTime
      || event?.scheduledAt
      || event?.scheduledFor
      || event?.dateTime
      || event?.date
      || event?.calendar?.startTime
      || event?.calendar?.startAt
      || event?.appointment?.startTime
      || event?.appointment?.startAt
    );
    if (!start) continue;

    const eventIds = collectPossibleRelationIds([event?.id, event?.eventId, event?.appointmentId, event?.calendarEventId]);
    eventIds.forEach((id) => byId.set(id, start));

    const opportunityIds = collectPossibleRelationIds([
      event?.opportunityId,
      event?.linkedOpportunityId,
      event?.opportunity,
      event?.opportunityIds,
      event?.relatedOpportunity,
      event?.relations,
      event?.relatedOpportunityIds,
      event?.calendar?.opportunityId,
      event?.appointment?.opportunityId,
    ]);
    opportunityIds.forEach((id) => byOpportunityId.set(id, start));

    const contactIds = collectPossibleRelationIds([
      event?.contactId,
      event?.linkedContactId,
      event?.contact,
      event?.contactIds,
      event?.relatedContact,
      event?.relations,
      event?.relatedContactIds,
      event?.calendar?.contactId,
      event?.appointment?.contactId,
    ]);
    contactIds.forEach((id) => byContactId.set(id, start));
  }

  return { byId, byOpportunityId, byContactId };
}

function getLinkedEventStartTime(opportunity: any, contact: any, eventIndex: ReturnType<typeof buildEventStartIndex>) {
  const opportunityRelationIds = collectPossibleRelationIds([
    opportunity?.id,
    opportunity?.opportunityId,
    opportunity?.eventId,
    opportunity?.eventIds,
    opportunity?.appointmentId,
    opportunity?.appointmentIds,
    opportunity?.calendarEventId,
    opportunity?.calendarEventIds,
    opportunity?.relations,
    opportunity?.related,
    opportunity?.events,
    opportunity?.appointments,
    opportunity?.calendarEvents,
  ]);

  for (const id of opportunityRelationIds) {
    const match = eventIndex.byId.get(id) || eventIndex.byOpportunityId.get(id);
    if (match) return match;
  }

  const contactRelationIds = collectPossibleRelationIds([
    contact?.id,
    contact?.contactId,
    contact?.eventId,
    contact?.eventIds,
    contact?.appointmentId,
    contact?.appointmentIds,
    contact?.calendarEventId,
    contact?.calendarEventIds,
    contact?.relations,
    contact?.related,
    contact?.events,
    contact?.appointments,
    contact?.calendarEvents,
  ]);

  for (const id of contactRelationIds) {
    const match = eventIndex.byId.get(id) || eventIndex.byContactId.get(id);
    if (match) return match;
  }

  return null;
}

function buildPipelineMetadata(pipelines: any[]) {
  const stageNameById = new Map<string, string>();
  const pipelineNameById = new Map<string, string>();

  for (const pipeline of pipelines) {
    const pipelineId = getFieldString(pipeline?.id || pipeline?.pipelineId);
    const pipelineName = getFieldString(pipeline?.name || pipeline?.label || pipeline?.title);
    if (pipelineId && pipelineName && !pipelineNameById.has(pipelineId)) {
      pipelineNameById.set(pipelineId, pipelineName);
    }

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

  return { stageNameById, pipelineNameById };
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

function serializeStatusValue(value: any): any {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') {
    const converted = value.toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted.toISOString() : null;
  }
  if (Array.isArray(value)) return value.map(serializeStatusValue);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, serializeStatusValue(nested)]));
  }
  return value;
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
    return NextResponse.json({ status: doc.exists ? serializeStatusValue(doc.data()) : null });
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

    const [contacts, opportunities, pipelines, appointmentEvents, leadsSnap] = await Promise.all([
      getGhlContactsAsync(),
      getGhlOpportunitiesAsync(),
      getGhlPipelinesAsync().catch(() => []),
      getGhlAppointmentEventsAsync().catch(() => []),
      adminDb().collection('leads').get(),
    ]);

    const leads = leadsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    const { stageNameById, pipelineNameById } = buildPipelineMetadata(pipelines);
    const eventIndex = buildEventStartIndex(appointmentEvents);

    const contactsByPhone = new Map<string, any[]>();
    for (const contact of contacts) {
      const phoneKeys = getContactPhoneKeys(contact);
      if (phoneKeys.length === 0) continue;
      for (const phoneKey of phoneKeys) {
        const current = contactsByPhone.get(phoneKey) || [];
        current.push(contact);
        contactsByPhone.set(phoneKey, current);
      }
    }

    const opportunitiesByContactId = new Map<string, any[]>();
    for (const opportunity of opportunities) {
      const contactId = getOpportunityContactId(opportunity);
      if (!contactId) continue;
      const current = opportunitiesByContactId.get(contactId) || [];
      current.push(opportunity);
      opportunitiesByContactId.set(contactId, current);
    }

    let matched = 0;
    let updated = 0;
    let skippedAmbiguous = 0;
    let unmatched = 0;
    let missingScheduledDateTime = 0;
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

      const pipelineId = getFieldString(opportunity?.pipelineId);
      const pipelineName = getFieldString(opportunity?.pipelineName || (pipelineId ? pipelineNameById.get(pipelineId) : null));
      if (norm(pipelineName) === 'inboundleadlocker') {
        auditRows.push({
          leadId: lead.id,
          leadName: getFieldString(lead?.name),
          phone: phoneKey,
          contactId,
          opportunityId: getFieldString(opportunity?.id || opportunity?.opportunityId),
          result: 'skipped',
          reason: 'excluded-pipeline-inbound-lead-locker',
          pipelineId,
          pipelineName,
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
      const linkedEventStartTime = getLinkedEventStartTime(opportunity, contact, eventIndex);
      const appointmentDateTime = toDateOrNull(
        opportunity?.appointmentStartTime
        || opportunity?.appointmentScheduledAtCanonical
        || opportunity?.appointmentDateTime
        || opportunity?.startTime
        || linkedEventStartTime
        || opportunity?.appointmentDate
        || opportunity?.scheduledAt
        || opportunity?.scheduledFor
        || opportunity?.appointmentTime
        || opportunity?.appointmentOccurredAt
      );
      const appointmentOutcome = normalizeOutcomeFromOpportunity(opportunity, stageNameById);
      const opportunityId = getFieldString(opportunity?.id || opportunity?.opportunityId);
      const patch = withNullSafePatch(lead, {
        appointmentDateTime,
        pipelineStageId,
        appointmentOutcome,
        ghlOpportunityId: opportunityId,
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

      if (!appointmentDateTime) {
        missingScheduledDateTime++;
        auditRows.push({
          leadId: lead.id,
          leadName: getFieldString(lead?.name),
          phone: phoneKey,
          contactId,
          opportunityId,
          result: 'matched-missing-datetime',
          reason: 'opportunity-matched-but-no-scheduled-datetime',
          matchedBy: 'phone',
          pipelineStageId,
          opportunityFieldPresence: {
            appointmentStartTime: !!opportunity?.appointmentStartTime,
            appointmentScheduledAtCanonical: !!opportunity?.appointmentScheduledAtCanonical,
            appointmentDateTime: !!opportunity?.appointmentDateTime,
            startTime: !!opportunity?.startTime,
            appointmentDate: !!opportunity?.appointmentDate,
            scheduledAt: !!opportunity?.scheduledAt,
            scheduledFor: !!opportunity?.scheduledFor,
            appointmentTime: !!opportunity?.appointmentTime,
            appointmentOccurredAt: !!opportunity?.appointmentOccurredAt,
            appointmentScheduledAtSource: !!opportunity?.appointmentScheduledAtSource,
            appointmentEventId: !!opportunity?.appointmentEventId,
          },
          linkedEventFound: !!linkedEventStartTime,
          syncedAt: new Date(),
        });
      }

      if (Object.keys(patch).length === 0) continue;

      batch.set(adminDb().collection('leads').doc(lead.id), patch, { merge: true });
      updated++;

      auditRows.push({
        leadId: lead.id,
        leadName: getFieldString(lead?.name),
        phone: phoneKey,
        contactId,
        opportunityId,
        result: 'updated',
        matchedBy: 'phone',
        outcome: appointmentOutcome,
        pipelineStageId,
        hasScheduledDateTime: !!appointmentDateTime,
        linkedEventFound: !!linkedEventStartTime,
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
      lastRunUnmatched: unmatched,
      skippedAmbiguous,
      missingScheduledDateTime,
      lastError: null,
    }, { merge: true });

    return NextResponse.json({ success: true, matched, updated, unmatched, lastRunUnmatched: unmatched, skippedAmbiguous, missingScheduledDateTime });
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
