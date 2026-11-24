// POST /api/empower-bump handler. Same approved-user pattern as
// POST /api/notifications/discord: Firebase bearer, test accounts 403,
// 8 requests per uid per 60s. Behind EMPOWER_BUMP_ENABLED.
//
// Order (FOR-BORIS-BACKEND-SPEC.md §1): flag -> auth -> validate -> rate limit
// -> receipt claim/replay -> GHL contact -> GHL opportunity -> bump event -> receipt.
// There is no Discord call here. ghl-sync is the single poster.

import { isTestAccount } from './discordNotification';
import {
  EMPOWER_CREATE_STAGE_ID,
  GHL_FIELDS,
  EMPOWER_STATUS_ON_CREATE,
  buildContactNote,
  estimatedTierLabel,
  neutralizeMentions,
  officialTierToWrite,
  parseEmpowerBumpBody,
  resolveBand,
  shouldWriteEmpowerStatus,
  splitName,
  ESTIMATED_BAND_LABELS,
  type EmpowerBumpRequest,
  type ResolvedBand,
} from './empowerBumpContract';
import {
  GhlRequestError,
  type EmpowerGhlClient,
  type GhlContact,
  type GhlContactWrite,
  type GhlCustomFieldWrite,
  type GhlOpportunity,
} from './empowerBumpGhl';
import type { EmpowerBumpEvent, EmpowerBumpEventStore, EmpowerBumpOutcome, EmpowerBumpReceiptStore } from './empowerBumpStore';
import {
  buildEmpowerBumpDiscordBody,
  type EmpowerBumpDiscordBody,
  type WebhookResolution,
} from './empowerBumpDiscord';
import { HttpError, requireApprovedUser, type RequireApprovedUserDeps } from './requireApprovedUser';

export const EMPOWER_BUMP_LIMIT = 8;
export const EMPOWER_BUMP_WINDOW_MS = 60_000;
export const EMPOWER_BUMP_NOT_CONFIGURED = 'Empower bump is not configured.';
export const EMPOWER_BUMP_AMBIGUOUS =
  "Couldn't confirm the GoHighLevel update. Check GHL before sending again.";

const HITS = new Map<string, number[]>();

export type RateLimitStore = Map<string, number[]>;

export type EmpowerBumpOptionalFields = {
  /** Contact field id for "Empower Estimated Band". Unset until Evan creates it. */
  estimatedBandFieldId?: string;
  /** Contact field id for "Empower Government Assistance". Unset until Evan creates it. */
  assistanceFieldId?: string;
  /** Exact tag name to add (e.g. "Empower Bump"). Unset = no tag write. */
  tag?: string;
};

export type EmpowerBumpLogger = (event: string, meta: Record<string, string | number | boolean>) => void;

export type EmpowerBumpDeps = RequireApprovedUserDeps & {
  /** Reads EMPOWER_BUMP_ENABLED. Called before anything else. */
  isEnabled: () => boolean;
  /** null when GHL or Firestore credentials are missing: 503, nothing written. */
  getServices: () => {
    ghl: EmpowerGhlClient;
    receipts: EmpowerBumpReceiptStore;
    events: EmpowerBumpEventStore;
    optionalFields: EmpowerBumpOptionalFields;
    discord: {
      resolveWebhook: () => Promise<WebhookResolution>;
      post: (url: string, body: EmpowerBumpDiscordBody) => Promise<{ ok: boolean; status: number }>;
    };
  } | null;
  now?: () => number;
  rateLimitStore?: RateLimitStore;
  log?: EmpowerBumpLogger;
};

export type EmpowerBumpResponseBody =
  | {
    success: true;
    outcome: EmpowerBumpOutcome;
    opportunityId: string;
    contactId: string;
    replay: boolean;
  }
  | { error: string };

export type EmpowerBumpResult = {
  status: number;
  body: EmpowerBumpResponseBody;
  headers?: Record<string, string>;
};

export function resetEmpowerBumpRateLimit(): void {
  HITS.clear();
}

export function isEmpowerBumpEnabled(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

export function allowEmpowerBump(uid: string, now: number, store: RateLimitStore = HITS): boolean {
  const recent = (store.get(uid) ?? []).filter((at) => now - at < EMPOWER_BUMP_WINDOW_MS);
  if (recent.length >= EMPOWER_BUMP_LIMIT) {
    store.set(uid, recent);
    return false;
  }
  recent.push(now);
  store.set(uid, recent);
  return true;
}

export function empowerBumpRetryAfterSeconds(uid: string, now: number, store: RateLimitStore = HITS): number {
  const recent = (store.get(uid) ?? []).filter((at) => now - at < EMPOWER_BUMP_WINDOW_MS);
  if (!recent.length) return 1;
  const oldest = Math.min(...recent);
  return Math.max(1, Math.ceil((EMPOWER_BUMP_WINDOW_MS - (now - oldest)) / 1000));
}

class MarkerWriteError extends Error {
  operation = 'bump opp marker';
  status = 0;
}

export class EmpowerBumpConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmpowerBumpConflict';
  }
}

function customFieldValue(contact: { customFields: Array<{ id: string; value: unknown }> } | null, id: string): unknown {
  return contact?.customFields.find((cf) => cf.id === id)?.value ?? null;
}

function last10(value: string | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function e164(last10Digits: string): string {
  return `+1${last10Digits}`;
}

function contactFields(req: EmpowerBumpRequest): GhlContactWrite {
  const { firstName, lastName } = splitName(req.name);
  const out: GhlContactWrite = { firstName, lastName, name: req.name, phone: e164(req.phoneLast10) };
  if (req.email) out.email = req.email;
  if (req.address) out.address1 = req.address;
  if (req.city) out.city = req.city;
  if (req.state) out.state = req.state;
  if (req.zip) out.postalCode = req.zip;
  return out;
}

export function buildContactCustomFields(input: {
  req: EmpowerBumpRequest;
  resolved: ResolvedBand;
  existing: GhlContact | null;
  optionalFields: EmpowerBumpOptionalFields;
}): GhlCustomFieldWrite[] {
  const { req, resolved, existing, optionalFields } = input;
  const fields: GhlCustomFieldWrite[] = [
    { id: GHL_FIELDS.contactHouseholdSize, fieldValue: req.householdSize },
    { id: GHL_FIELDS.contactEmpower, fieldValue: 'Yes' },
  ];
  if (req.annualHouseholdIncome !== undefined) {
    fields.push({ id: GHL_FIELDS.contactAnnualHouseholdIncome, fieldValue: req.annualHouseholdIncome });
  }
  if (!existing || shouldWriteEmpowerStatus(customFieldValue(existing, GHL_FIELDS.contactEmpowerStatus))) {
    fields.push({ id: GHL_FIELDS.contactEmpowerStatus, fieldValue: EMPOWER_STATUS_ON_CREATE });
  }
  const tier = officialTierToWrite(resolved, customFieldValue(existing, GHL_FIELDS.contactEmpowerTier));
  if (tier) fields.push({ id: GHL_FIELDS.contactEmpowerTier, fieldValue: tier });
  if (optionalFields.estimatedBandFieldId && resolved.band) {
    fields.push({ id: optionalFields.estimatedBandFieldId, fieldValue: ESTIMATED_BAND_LABELS[resolved.band] });
  }
  if (optionalFields.assistanceFieldId) {
    if (req.assistancePrograms.length) {
      fields.push({ id: optionalFields.assistanceFieldId, fieldValue: [...req.assistancePrograms] });
    } else if (req.assistanceNone) {
      fields.push({ id: optionalFields.assistanceFieldId, fieldValue: [] });
    }
  }
  return fields;
}

function opportunityNotesValue(opp: GhlOpportunity | null, note: string): string | null {
  if (!opp) return note;
  const existing = customFieldValue(opp, GHL_FIELDS.opportunityNotes);
  if (existing == null || existing === '') return note;
  if (typeof existing !== 'string') return null; // unreadable: do not risk replacing it
  return `${existing}\n\n${note}`;
}

/** `existing` is the opp being updated, or null for a create (tier currently empty). */
export function buildOpportunityCustomFields(
  resolved: ResolvedBand,
  notes: string | null,
  existing: GhlOpportunity | null,
): GhlCustomFieldWrite[] {
  const fields: GhlCustomFieldWrite[] = [{ id: GHL_FIELDS.opportunityEmpower, fieldValue: 'Yes' }];
  const tier = officialTierToWrite(resolved, customFieldValue(existing, GHL_FIELDS.opportunityEmpowerTier));
  if (tier) fields.push({ id: GHL_FIELDS.opportunityEmpowerTier, fieldValue: tier });
  if (notes) fields.push({ id: GHL_FIELDS.opportunityNotes, fieldValue: notes });
  return fields;
}

/**
 * Most recently updated OPEN Empower+ opp, or null (=> create a new one).
 * Closed opps (won/lost/abandoned) are never touched. A missing status is
 * ambiguous: treating it as closed could create a duplicate of an open opp.
 */
export function pickEmpowerOpportunity(opps: GhlOpportunity[]): GhlOpportunity | null {
  if (opps.some((opp) => !opp.status)) throw new GhlRequestError('opportunity search', 200);
  const open = opps.filter((opp) => opp.status === 'open');
  if (!open.length) return null;
  return [...open].sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export async function upsertEmpowerBumpInGhl(input: {
  ghl: EmpowerGhlClient;
  req: EmpowerBumpRequest;
  resolved: ResolvedBand;
  optionalFields: EmpowerBumpOptionalFields;
  onOpportunityCreated?: (created: { opportunityId: string; contactId: string }) => Promise<void>;
}): Promise<{ contactId: string; opportunityId: string; outcome: EmpowerBumpOutcome }> {
  const { ghl, req, resolved, optionalFields } = input;

  // 3. Contact lookup: last-10 phone first, then email. Two different matches: 409, no write.
  let byPhone = await ghl.findContactByPhone(e164(req.phoneLast10));
  if (byPhone && byPhone.phone && last10(byPhone.phone) !== req.phoneLast10) byPhone = null;
  let byEmail: GhlContact | null = null;
  if (req.email) {
    byEmail = await ghl.findContactByEmail(req.email);
    if (byEmail && byEmail.email && byEmail.email.toLowerCase() !== req.email.toLowerCase()) byEmail = null;
  }
  if (byPhone && byEmail && byPhone.id !== byEmail.id) {
    throw new EmpowerBumpConflict('This phone and email belong to two different GHL contacts. Fix the contact in GHL first.');
  }
  const match = byPhone ?? byEmail;

  // 4. Contact create or update.
  // The full record is needed to read the current tier and status. If it cannot
  // be read, an empty-looking tier could be overwritten, so fail as ambiguous.
  let existing: GhlContact | null = null;
  if (match) {
    existing = await ghl.getContact(match.id);
    if (!existing) throw new GhlRequestError('contact read', 404);
  }
  const fields = buildContactCustomFields({ req, resolved, existing, optionalFields });
  let contactId: string;
  if (match) {
    contactId = match.id;
    await ghl.updateContact(contactId, { ...contactFields(req), customFields: fields });
  } else {
    contactId = await ghl.createContact({ ...contactFields(req), customFields: fields });
  }

  const currentTier = customFieldValue(existing, GHL_FIELDS.contactEmpowerTier);
  const tierWritten = fields.some((f) => f.id === GHL_FIELDS.contactEmpowerTier);
  const keptOfficialTier = !tierWritten && (currentTier === 'Tier 1' || currentTier === 'Tier 3') ? currentTier : null;
  const note = buildContactNote(req, resolved, { keptOfficialTier });
  await ghl.addContactNote(contactId, note);
  if (optionalFields.tag) await ghl.addContactTags(contactId, [optionalFields.tag]);

  // 5. Opportunity: update an existing Empower+ opp, never a second one.
  const opps = await ghl.listEmpowerOpportunities(contactId);
  const target = pickEmpowerOpportunity(opps);
  if (target) {
    await ghl.updateOpportunity(target.id, {
      customFields: buildOpportunityCustomFields(resolved, opportunityNotesValue(target, note), target),
    });
    return { contactId, opportunityId: target.id, outcome: 'updated' };
  }
  const opportunityId = await ghl.createOpportunity({
    name: req.name,
    contactId,
    pipelineStageId: EMPOWER_CREATE_STAGE_ID,
    customFields: buildOpportunityCustomFields(resolved, note, null),
  });
  // Record the new opp id for ghl-sync right away, before anything else, so
  // its generic "Opportunity Created" check finds it (see docs/empower-bump.md).
  await input.onOpportunityCreated?.({ opportunityId, contactId });
  return { contactId, opportunityId, outcome: 'created' };
}

function profileName(user: Record<string, unknown>): string {
  const raw = typeof user.name === 'string' ? user.name : typeof user.displayName === 'string' ? user.displayName : '';
  return raw.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 80);
}

export async function handleEmpowerBump(input: {
  authorization: string | null;
  idempotencyKey: string | null;
  body: unknown;
  deps: EmpowerBumpDeps;
}): Promise<EmpowerBumpResult> {
  const { deps } = input;
  const log: EmpowerBumpLogger = deps.log ?? (() => {});

  // 1. Flag off: 503 before auth, before any read or write.
  if (!deps.isEnabled()) return { status: 503, body: { error: EMPOWER_BUMP_NOT_CONFIGURED } };

  let approved;
  try {
    approved = await requireApprovedUser(input.authorization, deps);
  } catch (error) {
    if (error instanceof HttpError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
  if (isTestAccount(approved.uid, approved.user)) {
    return { status: 403, body: { error: 'Test accounts cannot send Empower bumps.' } };
  }

  const parsed = parseEmpowerBumpBody(input.body, input.idempotencyKey);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const req = parsed.value;

  const now = deps.now?.() ?? Date.now();
  const store = deps.rateLimitStore ?? HITS;
  if (!allowEmpowerBump(approved.uid, now, store)) {
    return {
      status: 429,
      body: { error: 'Too many Empower bumps. Try again in a minute.' },
      headers: { 'Retry-After': String(empowerBumpRetryAfterSeconds(approved.uid, now, store)) },
    };
  }

  const services = deps.getServices();
  if (!services) return { status: 503, body: { error: EMPOWER_BUMP_NOT_CONFIGURED } };

  // 2. Receipt replay / in-flight claim.
  const claim = await services.receipts.claim({ uid: approved.uid, draftId: req.draftId, leadId: req.leadId, nowMs: now });
  if (claim.kind === 'replay') {
    log('replay', { outcome: claim.receipt.outcome });
    return {
      status: 200,
      body: {
        success: true,
        outcome: claim.receipt.outcome,
        opportunityId: claim.receipt.opportunityId,
        contactId: claim.receipt.contactId,
        replay: true,
      },
    };
  }
  if (claim.kind === 'in_flight') {
    return { status: 409, body: { error: 'This bump is already being sent. Check again in a minute.' } };
  }
  if (claim.kind === 'draft_reused') {
    return { status: 409, body: { error: 'This draft id was already used for another lead.' } };
  }

  const resolved = resolveBand(req);
  const repName = profileName(approved.user) || req.repName || 'Unknown Rep';

  let ghlResult;
  try {
    ghlResult = await upsertEmpowerBumpInGhl({
      ghl: services.ghl,
      req,
      resolved,
      optionalFields: services.optionalFields,
      onOpportunityCreated: async ({ opportunityId, contactId }) => {
        try {
          await services.events.markOpportunityCreated({ opportunityId, contactId, draftId: req.draftId }, now);
        } catch {
          // The opp exists in GHL; without the marker ghl-sync may post the
          // generic "Opportunity Created" after its grace period. Ambiguous.
          throw new MarkerWriteError();
        }
      },
    });
  } catch (error) {
    await services.receipts.release(approved.uid, req.draftId).catch(() => {});
    if (error instanceof EmpowerBumpConflict) {
      log('conflict', {});
      return { status: 409, body: { error: error.message } };
    }
    log('ghl_failed', { operation: (error as { operation?: string })?.operation ?? 'unknown', status: (error as { status?: number })?.status ?? 0 });
    return { status: 502, body: { error: EMPOWER_BUMP_AMBIGUOUS } };
  }

  // 6. Bump event for ghl-sync (Discord), then the receipt, then 200.
  try {
    const event: EmpowerBumpEvent = {
      draftId: req.draftId,
      uid: approved.uid,
      leadId: req.leadId,
      opportunityId: ghlResult.opportunityId,
      contactId: ghlResult.contactId,
      outcome: ghlResult.outcome,
      opportunityCreated: ghlResult.outcome === 'created',
      name: neutralizeMentions(req.name),
      town: neutralizeMentions(req.town ?? ''),
      repName: neutralizeMentions(repName),
      householdSize: req.householdSize,
      estimatedTierLabel: estimatedTierLabel(resolved.band),
      assistanceYes: req.assistancePrograms.length > 0,
      actedAt: req.actedAt,
    };
    await services.events.createEvent(event, now);
    await services.receipts.complete({
      draftId: req.draftId,
      uid: approved.uid,
      leadId: req.leadId,
      actedAt: req.actedAt,
      contactId: ghlResult.contactId,
      opportunityId: ghlResult.opportunityId,
      outcome: ghlResult.outcome,
    }, now);
  } catch {
    // GHL was written. A manual resend finds the Empower+ opp and updates it
    // (no second opp) and the create-only event prevents a second post.
    await services.receipts.release(approved.uid, req.draftId).catch(() => {});
    log('receipt_failed', { outcome: ghlResult.outcome });
    return { status: 502, body: { error: EMPOWER_BUMP_AMBIGUOUS } };
  }

  log('ok', { outcome: ghlResult.outcome, band: resolved.band ?? 'none', categorical: resolved.categorical });
  // Discord never changes the response: GHL and the receipt are already done.
  await deliverEmpowerBumpDiscord({ draftId: req.draftId, services, now, log });
  return {
    status: 200,
    body: {
      success: true,
      outcome: ghlResult.outcome,
      opportunityId: ghlResult.opportunityId,
      contactId: ghlResult.contactId,
      replay: false,
    },
  };
}

/**
 * One "Empower Plus bump" post per draft. Only a still-pending event is posted,
 * claimed atomically, so a replay or a concurrent resend posts nothing. A
 * failed post is marked error and never retried. No webhook: stays pending.
 */
export async function deliverEmpowerBumpDiscord(input: {
  draftId: string;
  services: NonNullable<ReturnType<EmpowerBumpDeps['getServices']>>;
  now: number;
  log: EmpowerBumpLogger;
}): Promise<'sent' | 'pending' | 'error' | 'skipped'> {
  const { draftId, services, now, log } = input;
  try {
    const destination = await services.discord.resolveWebhook();
    if (destination.url === null) {
      await services.events.markDelivery(draftId, { status: 'pending', reason: destination.reason }, now).catch(() => {});
      log('discord_pending', { reason: destination.reason });
      return 'pending';
    }
    const event = await services.events.claimDelivery(draftId, now);
    if (!event) return 'skipped';
    const posted = await services.discord.post(destination.url, buildEmpowerBumpDiscordBody(event, now));
    await services.events.markDelivery(draftId, {
      status: posted.ok ? 'sent' : 'error',
      responseStatus: posted.status,
      source: destination.source,
    }, now).catch(() => {});
    if (posted.ok) {
      log('discord_sent', { source: destination.source });
      return 'sent';
    }
    log('discord_failed', { source: destination.source, status: posted.status });
    return 'error';
  } catch {
    log('discord_failed', { status: 0 });
    return 'error';
  }
}
