import assert from 'node:assert/strict';
import { normalizeMunicipality, normalizeStreet } from '@/app/homeowners/model';
import { insideTerritory, territoryBounds } from '@/app/utils/territoryManager';
import {
  GPS_HOMEOWNER_NEAR_LEAD_M,
  GPS_HOMEOWNER_SAME_STREET_M,
  decideKnockGps,
  finitePoint,
  gpsFlagOf,
  isAreaExemptRole,
  metersBetween,
  type AreaPolygons,
  type GpsDecision,
  type KnockFix,
  type LatLng,
} from '@/app/utils/gpsRule';
import { isTestAccount } from './discordNotification';
import { FIELD_REASON_CODES, type FieldReasonCode } from './fieldReasonCodes';

const KNOWN_REASONS: ReadonlySet<string> = new Set(FIELD_REASON_CODES);
import {
  HttpError,
  requireApprovedUser,
  type RequireApprovedUserDeps,
  type UserProfile,
} from './requireApprovedUser';

export const FIELD_DISPO_LIMIT = 60;
export const FIELD_DISPO_WINDOW_MS = 60_000;
export const FIELD_DISPO_MAX_BYTES = 32 * 1024;
/** kind:notes may be larger. Knock and other dispos stay at FIELD_DISPO_MAX_BYTES. */
export const FIELD_DISPO_NOTES_BODY_MAX = 256 * 1024;
const NOTES_TEXT_MAX = 100_000;
export const TERRITORY_QUERY_LIMIT = 200;
export const HISTORY_CAP = 500;
const RECEIPT_RESPONSE_MAX_BYTES = 2048;
const ACTION_PAST_MS = 30 * 24 * 60 * 60 * 1000;
const ACTION_FUTURE_MS = 10 * 60 * 1000;
const GOBACK_PAST_MS = 24 * 60 * 60 * 1000;
const GOBACK_FUTURE_MS = 366 * 24 * 60 * 60 * 1000;

const DRAFT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const STATUS_RE = /^[a-z0-9-]{1,64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const BANNED_STATUS = new Set(['claimed', 'unclaimed']);
const OBJECTION_TYPES = new Set([
  'too-expensive',
  'bad-credit',
  'roof-issues',
  'moving-soon',
  'not-owner',
  'already-has-solar',
  'too-complicated',
  'need-to-think',
  'not-interested-in-solar',
  'other',
]);
const TOP_KEYS = new Set([
  'draftId',
  'leadId',
  'kind',
  'actionAt',
  'status',
  'disposition',
  'userName',
  'gps',
  'gpsVerified',
  'gpsUnverifiedReason',
  'gpsDistanceM',
  'homeownerId',
  'goBack',
  'objection',
  'notes',
  'baseNotes',
]);
const KNOCK_KEYS = new Set([
  'draftId',
  'leadId',
  'kind',
  'actionAt',
  'status',
  'disposition',
  'userName',
  'gps',
  'gpsVerified',
  'gpsUnverifiedReason',
  'gpsDistanceM',
  'homeownerId',
  'goBack',
  'objection',
]);
const NOTES_KEYS = new Set(['draftId', 'leadId', 'kind', 'actionAt', 'notes', 'baseNotes']);
const GPS_KEYS = new Set(['lat', 'lng', 'accuracyM', 'capturedAt']);
const GOBACK_KEYS = new Set(['scheduledDate', 'scheduledTime', 'notes']);
const OBJECTION_KEYS = new Set(['type', 'notes']);

export const ALLOWED_PATCH_KEYS = new Set([
  'status',
  'disposition',
  'dispositionedAt',
  'dispositionHistory',
  'knockGpsLat',
  'knockGpsLng',
  'knockGpsAccuracy',
  'knockGpsTimestamp',
  'knockDistanceFromAddress',
  'gpsVerified',
  'gpsUnverifiedReason',
  'gpsDistanceM',
  'goBackScheduledDate',
  'goBackScheduledTime',
  'goBackNotes',
  'goBackScheduledBy',
  'objectionType',
  'objectionNotes',
  'objectionRecordedAt',
  'objectionRecordedBy',
  'notes',
]);

/**
 * Per-instance, in-memory, best effort. Each server process keeps its own
 * window, so the limit is not shared across instances.
 */
const HITS = new Map<string, number[]>();

export type RateLimitStore = Map<string, number[]>;

export type DispoSnap = {
  exists: boolean;
  id: string;
  data: () => Record<string, unknown> | undefined;
};

export type DispoDocRef = {
  id: string;
  path: string;
  get: () => Promise<DispoSnap>;
};

export type DispoFilter = { field: string; op: string; value: string };

export type DispoQuery = {
  kind: 'query';
  collectionName: string;
  filters: readonly DispoFilter[];
  limitCount: number | null;
  limit: (n: number) => DispoQuery;
};

export type DispoCollection = {
  name: string;
  doc: (id: string) => DispoDocRef;
  where: (field: string, op: string, value: string) => DispoQuery;
};

export type DispoTransaction = {
  get: (ref: DispoDocRef) => Promise<DispoSnap>;
  getQuery: (query: DispoQuery) => Promise<{ docs: DispoSnap[] }>;
  update: (ref: DispoDocRef, data: Record<string, unknown>) => void;
  create: (ref: DispoDocRef, data: Record<string, unknown>) => void;
};

export type DispoDb = {
  collection: (name: string) => DispoCollection;
  runTransaction: <T>(fn: (tx: DispoTransaction) => Promise<T>) => Promise<T>;
};

export type TimestampFactory = {
  fromMillis: (ms: number) => { toMillis: () => number };
};

export type FieldDispoDeps = RequireApprovedUserDeps & {
  db: DispoDb;
  now?: () => number;
  rateLimitStore?: RateLimitStore;
  Timestamp: TimestampFactory;
  serverTimestamp: () => unknown;
  /** Firestore field delete. The route passes FieldValue.delete(). */
  deleteField: () => unknown;
};

export type FieldDispoResult = {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

type GpsFix = KnockFix & { capturedAtMs: number };

type GoBackInput = {
  scheduledDateMs: number;
  scheduledTime: string;
  notes: string;
};

type ObjectionInput = {
  type: string;
  notes: string;
};

type ParsedKnock = {
  kind: 'knock';
  draftId: string;
  leadId: string;
  actionAtMs: number;
  status: string;
  disposition: string;
  userName: string;
  gps: GpsFix | 'absent' | 'malformed';
  /** Set only when the body id matches the homeowner id pattern. Never stored. */
  homeownerId: string | null;
  goBack: GoBackInput | null;
  objection: ObjectionInput | null;
};

type ParsedNotes = {
  kind: 'notes';
  draftId: string;
  leadId: string;
  actionAtMs: number;
  notes: string;
  baseNotes: string;
};

type ParsedDraft = ParsedKnock | ParsedNotes;

type TxOutcome = {
  status: number;
  body: Record<string, unknown>;
  mismatch?: boolean;
  historyDropped?: number;
};

export function resetFieldDispoRateLimit(): void {
  HITS.clear();
}

export function allowFieldDispo(
  uid: string,
  now: number,
  store: RateLimitStore = HITS,
  limit = FIELD_DISPO_LIMIT,
  windowMs = FIELD_DISPO_WINDOW_MS,
): boolean {
  const recent = (store.get(uid) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= limit) {
    store.set(uid, recent);
    return false;
  }
  recent.push(now);
  store.set(uid, recent);
  return true;
}

/** Seconds until the oldest hit in the current window expires. At least 1. */
export function fieldDispoRetryAfterSeconds(
  uid: string,
  now: number,
  store: RateLimitStore = HITS,
  windowMs = FIELD_DISPO_WINDOW_MS,
): number {
  const recent = (store.get(uid) ?? []).filter((at) => now - at < windowMs);
  if (recent.length === 0) return Math.ceil(windowMs / 1000);
  const oldest = Math.min(...recent);
  return Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
}

/**
 * Mirrors firestore.rules profileApprovedActive(), including its defaults.
 * A missing isActive, approved, approvalStatus, status, deleted, deletedAt,
 * or deletionPending flag stays allowed, so a legacy rep the rules already
 * allow is not blocked. Explicit inactive, unapproved, pending, deleted,
 * or deletion-pending profiles are denied.
 */
export function assertFieldWriter(user: UserProfile): boolean {
  const role = typeof user.role === 'string' ? user.role : '';
  if (role !== 'admin' && role !== 'manager' && role !== 'setter' && role !== 'closer') return false;
  if (user.isActive === false) return false;
  if (user.approved === false) return false;
  if (Object.prototype.hasOwnProperty.call(user, 'approvalStatus') && user.approvalStatus !== 'approved') {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(user, 'status') && user.status !== 'active') return false;
  if (user.deleted === true) return false;
  if (Object.prototype.hasOwnProperty.call(user, 'deletedAt') && user.deletedAt != null) return false;
  if (user.deletionPending === true) return false;
  return true;
}

export function assertAllowedPatch(patch: Record<string, unknown>): void {
  assert.ok(
    Object.keys(patch).every((key) => ALLOWED_PATCH_KEYS.has(key)),
    'Dispo patch left the allowlist',
  );
}

/** Same validId predicate as app/utils/server/mobileLeads.ts. It is not exported there. */
function validLeadId(id: string): boolean {
  return id.length > 0 && id.length <= 1500 && !id.includes('/') && id !== '.' && id !== '..';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * TEST gate for this route. firestore.rules isTest() reads only
 * isTestAccount == true, testData == true, and team == 'TEST'.
 * This route also denies through isTestAccount(), which the rules do not
 * read: an email ending in @test.com, accountType 'test', isTest == true,
 * testAccount == true, a uid prefixed user-test- or test- (any case), and a
 * nested truthy testData or isTestAccount flag. Those accounts can still
 * pass a direct rules write. team == 'TEST' is denied here and by the rules.
 */
function isBlockedTestAccount(uid: string, user: UserProfile): boolean {
  if (isTestAccount(uid, user)) return true;
  return user.team === 'TEST';
}

function logLine(status: number, token: string): void {
  console.log(`[field/dispo] ${status} ${token}`);
}

function finish(status: number, body: Record<string, unknown>, headers?: Record<string, string>): FieldDispoResult {
  const token = typeof body.result === 'string'
    ? body.result
    : typeof body.reasonCode === 'string'
      ? body.reasonCode
      : typeof body.error === 'string'
        ? body.error
        : 'internal';
  logLine(status, token);
  return headers ? { status, body, headers } : { status, body };
}

function invalid(field: string): FieldDispoResult {
  return finish(400, { ok: false, error: 'invalid_payload', reasonCode: 'invalid_payload', field });
}

function tooLarge(): FieldDispoResult {
  return finish(413, { ok: false, error: 'too_large' });
}

function payloadTooLarge(): FieldDispoResult {
  return finish(413, { ok: false, error: 'payload_too_large' });
}

/** True when the unread or oversized body is a notes draft. */
function notesPayload(rawBody: string | undefined, body: unknown): boolean {
  if (isPlainObject(body) && body.kind === 'notes') return true;
  return typeof rawBody === 'string' && /"kind"\s*:\s*"notes"/.test(rawBody);
}

function notesTextOverMax(payload: Record<string, unknown>): boolean {
  const { notes, baseNotes } = payload;
  return (typeof notes === 'string' && notes.length > NOTES_TEXT_MAX)
    || (typeof baseNotes === 'string' && baseNotes.length > NOTES_TEXT_MAX);
}

function forbidden(reasonCode: FieldReasonCode): FieldDispoResult {
  if (!KNOWN_REASONS.has(reasonCode)) throw new Error('Unknown dispo reason');
  return finish(403, { ok: false, error: 'forbidden', reasonCode });
}

function parseIsoMillis(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function boundedString(value: unknown, max: number, allowEmpty: boolean): string | null {
  if (typeof value !== 'string') return null;
  if (!allowEmpty && value.length < 1) return null;
  if (value.length > max) return null;
  return value;
}

function firstUnknown(body: Record<string, unknown>, allowed: Set<string>): string | null {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return key;
  }
  return null;
}

/** A present gps value that is not a usable fix is stored as no_fix. Never a 400. */
function parseGps(value: unknown): GpsFix | 'malformed' {
  if (!isPlainObject(value)) return 'malformed';
  if (firstUnknown(value, GPS_KEYS)) return 'malformed';
  for (const key of GPS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return 'malformed';
  }
  const capturedAtMs = parseIsoMillis(value.capturedAt);
  if (capturedAtMs == null) return 'malformed';
  const point = finitePoint(value.lat, value.lng);
  const { accuracyM } = value;
  if (!point || typeof accuracyM !== 'number' || !Number.isFinite(accuracyM) || accuracyM < 0 || accuracyM > 100_000) {
    return 'malformed';
  }
  return { ...point, accuracyM, capturedAtMs };
}

function parseGoBack(value: unknown, now: number): { ok: true; goBack: GoBackInput } | { ok: false; field: string } {
  if (!isPlainObject(value)) return { ok: false, field: 'goBack' };
  const unknown = firstUnknown(value, GOBACK_KEYS);
  if (unknown) return { ok: false, field: `goBack.${unknown}` };
  const scheduledDateMs = parseIsoMillis(value.scheduledDate);
  if (scheduledDateMs == null) return { ok: false, field: 'goBack.scheduledDate' };
  if (scheduledDateMs < now - GOBACK_PAST_MS || scheduledDateMs > now + GOBACK_FUTURE_MS) {
    return { ok: false, field: 'goBack.scheduledDate' };
  }
  let scheduledTime = '';
  if (Object.prototype.hasOwnProperty.call(value, 'scheduledTime') && value.scheduledTime != null && value.scheduledTime !== '') {
    if (typeof value.scheduledTime !== 'string' || value.scheduledTime.length > 16) {
      return { ok: false, field: 'goBack.scheduledTime' };
    }
    scheduledTime = value.scheduledTime;
  }
  let notes = '';
  if (Object.prototype.hasOwnProperty.call(value, 'notes') && value.notes != null && value.notes !== '') {
    if (typeof value.notes !== 'string' || value.notes.length > 2000) return { ok: false, field: 'goBack.notes' };
    notes = value.notes;
  }
  return { ok: true, goBack: { scheduledDateMs, scheduledTime, notes } };
}

function parseObjection(value: unknown): { ok: true; objection: ObjectionInput } | { ok: false; field: string } {
  if (!isPlainObject(value)) return { ok: false, field: 'objection' };
  const unknown = firstUnknown(value, OBJECTION_KEYS);
  if (unknown) return { ok: false, field: `objection.${unknown}` };
  if (typeof value.type !== 'string' || !OBJECTION_TYPES.has(value.type)) {
    return { ok: false, field: 'objection.type' };
  }
  let notes = '';
  if (Object.prototype.hasOwnProperty.call(value, 'notes') && value.notes != null && value.notes !== '') {
    if (typeof value.notes !== 'string' || value.notes.length > 2000) return { ok: false, field: 'objection.notes' };
    notes = value.notes;
  }
  return { ok: true, objection: { type: value.type, notes } };
}

function parseDraft(body: unknown, now: number): { ok: true; draft: ParsedDraft } | { ok: false; field: string } {
  if (!isPlainObject(body)) return { ok: false, field: 'body' };
  const unknown = firstUnknown(body, TOP_KEYS);
  if (unknown) return { ok: false, field: unknown };
  if (typeof body.draftId !== 'string' || !DRAFT_ID_RE.test(body.draftId)) return { ok: false, field: 'draftId' };
  if (typeof body.leadId !== 'string' || !validLeadId(body.leadId)) return { ok: false, field: 'leadId' };
  if (body.kind !== 'knock' && body.kind !== 'notes') return { ok: false, field: 'kind' };
  const actionAtMs = parseIsoMillis(body.actionAt);
  if (actionAtMs == null || actionAtMs < now - ACTION_PAST_MS || actionAtMs > now + ACTION_FUTURE_MS) {
    return { ok: false, field: 'actionAt' };
  }
  const allowed = body.kind === 'knock' ? KNOCK_KEYS : NOTES_KEYS;
  const kindUnknown = firstUnknown(body, allowed);
  if (kindUnknown) return { ok: false, field: kindUnknown };

  if (body.kind === 'notes') {
    const notes = boundedString(body.notes, NOTES_TEXT_MAX, true);
    if (notes == null) return { ok: false, field: 'notes' };
    let baseNotes = '';
    if (Object.prototype.hasOwnProperty.call(body, 'baseNotes') && body.baseNotes != null) {
      const parsedBase = boundedString(body.baseNotes, NOTES_TEXT_MAX, true);
      if (parsedBase == null) return { ok: false, field: 'baseNotes' };
      baseNotes = parsedBase;
    }
    return { ok: true, draft: { kind: 'notes', draftId: body.draftId, leadId: body.leadId, actionAtMs, notes, baseNotes } };
  }

  const status = boundedString(body.status, 64, false);
  if (status == null || !STATUS_RE.test(status) || BANNED_STATUS.has(status)) return { ok: false, field: 'status' };
  const disposition = boundedString(body.disposition, 64, false);
  if (disposition == null) return { ok: false, field: 'disposition' };
  const userName = boundedString(body.userName, 120, false);
  if (userName == null) return { ok: false, field: 'userName' };

  const goBackPresent = isPlainObject(body.goBack);
  const objectionPresent = isPlainObject(body.objection);
  if (goBackPresent && objectionPresent) return { ok: false, field: 'goBack' };
  if (Object.prototype.hasOwnProperty.call(body, 'goBack') && body.goBack != null && !goBackPresent) {
    return { ok: false, field: 'goBack' };
  }
  if (Object.prototype.hasOwnProperty.call(body, 'objection') && body.objection != null && !objectionPresent) {
    return { ok: false, field: 'objection' };
  }

  let gps: GpsFix | 'absent' | 'malformed' = 'absent';
  if (Object.prototype.hasOwnProperty.call(body, 'gps') && body.gps != null) {
    gps = parseGps(body.gps);
  }
  const homeownerId = typeof body.homeownerId === 'string' && DRAFT_ID_RE.test(body.homeownerId)
    ? body.homeownerId
    : null;
  let goBack: GoBackInput | null = null;
  if (goBackPresent) {
    const parsedGoBack = parseGoBack(body.goBack, now);
    if (!parsedGoBack.ok) return parsedGoBack;
    goBack = parsedGoBack.goBack;
  }
  let objection: ObjectionInput | null = null;
  if (objectionPresent) {
    const parsedObjection = parseObjection(body.objection);
    if (!parsedObjection.ok) return parsedObjection;
    objection = parsedObjection.objection;
  }
  return {
    ok: true,
    draft: {
      kind: 'knock',
      draftId: body.draftId,
      leadId: body.leadId,
      actionAtMs,
      status,
      disposition,
      userName,
      gps,
      homeownerId,
      goBack,
      objection,
    },
  };
}

function emptyId(value: unknown): boolean {
  return value == null || value === '';
}

function ownsLead(lead: Record<string, unknown>, uid: string): boolean {
  if (lead.claimedBy === uid) return true;
  if (lead.assignedTo === uid) return true;
  return lead.setterId === uid && lead.source === 'manually-added';
}

function isOther(value: unknown, uid: string): boolean {
  return !emptyId(value) && value !== uid;
}

function leadCoords(lead: Record<string, unknown>): LatLng | null {
  return finitePoint(lead.lat, lead.lng);
}

function polygonOf(value: unknown): Array<{ lat: number; lng: number }> | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const points: Array<{ lat: number; lng: number }> = [];
  for (const point of value) {
    if (!isPlainObject(point)) return null;
    if (typeof point.lat !== 'number' || typeof point.lng !== 'number') return null;
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
    points.push({ lat: point.lat, lng: point.lng });
  }
  return points;
}

/**
 * territoryId ownership follows firestore.rules leadInMyTerritory().
 * One direct read of territories/{lead.territoryId}. That predicate does not
 * look at claimedBy, assignedTo, or archived, so a territory owner can still
 * disposition another rep's claimed or assigned pin. The 200-row user query
 * is not this check: a rep with more than 200 territories still matches.
 * Polygon containment is only the extra map-pin path for unowned leads, and
 * it ignores archived territories and polygons with fewer than 3 points.
 */
async function territoryOwnedByDirectRead(
  db: DispoDb,
  tx: DispoTransaction,
  territoryId: unknown,
  uid: string,
): Promise<boolean> {
  if (typeof territoryId !== 'string' || !validLeadId(territoryId)) return false;
  const snap = await tx.get(db.collection('territories').doc(territoryId));
  if (!snap.exists) return false;
  return (snap.data() ?? {}).userId === uid;
}

function insideCallerPolygon(docs: DispoSnap[], lat: number, lng: number, uid: string): boolean {
  for (const doc of docs) {
    const data = doc.data() ?? {};
    if (data.userId !== uid || data.archived) continue;
    const polygon = polygonOf(data.polygon);
    if (!polygon) continue;
    const bounds = territoryBounds(polygon);
    if (lat < bounds.south || lat > bounds.north || lng < bounds.west || lng > bounds.east) continue;
    if (insideTerritory(lat, lng, polygon)) return true;
  }
  return false;
}

async function loadTerritories(
  db: DispoDb,
  tx: DispoTransaction,
  uid: string,
): Promise<{ docs: DispoSnap[]; truncated: boolean }> {
  const query = db.collection('territories').where('userId', '==', uid).limit(TERRITORY_QUERY_LIMIT);
  const snap = await tx.getQuery(query);
  const truncated = snap.docs.length >= TERRITORY_QUERY_LIMIT;
  if (truncated) console.log('[field/dispo] territories_truncated 1');
  return { docs: snap.docs, truncated };
}

function countedPolygons(docs: DispoSnap[], uid: string): Array<Array<{ lat: number; lng: number }>> {
  const polygons: Array<Array<{ lat: number; lng: number }>> = [];
  for (const doc of docs) {
    const data = doc.data() ?? {};
    if (data.userId !== uid || data.archived) continue;
    const polygon = polygonOf(data.polygon);
    if (polygon) polygons.push(polygon);
  }
  return polygons;
}

function placeName(doc: Record<string, unknown>, streetKey: string, fallbackKey: string): string {
  const primary = doc[streetKey];
  return normalizeStreet(typeof primary === 'string' ? primary : doc[fallbackKey]);
}

function cityName(doc: Record<string, unknown>, primaryKey: string, fallbackKey: string): string {
  const primary = doc[primaryKey];
  return normalizeMunicipality(typeof primary === 'string' ? primary : doc[fallbackKey]);
}

/**
 * Use the named homeowner only when it is within 75 m of the lead, or within
 * 2000 m with the same normalized street and municipality. Otherwise the
 * lead's own lat/lng is the reference. The route does not search for a match.
 */
function referencePoint(lead: Record<string, unknown>, homeowner: Record<string, unknown> | null): LatLng | null {
  const leadPoint = leadCoords(lead);
  if (!homeowner || !leadPoint) return leadPoint;
  const homePoint = leadCoords(homeowner);
  if (!homePoint) return leadPoint;
  const apart = metersBetween(homePoint, leadPoint);
  if (!Number.isFinite(apart)) return leadPoint;
  if (apart <= GPS_HOMEOWNER_NEAR_LEAD_M) return homePoint;
  if (apart > GPS_HOMEOWNER_SAME_STREET_M) return leadPoint;
  const leadStreet = placeName(lead, 'street', 'address');
  const homeStreet = placeName(homeowner, 'street', 'address');
  const leadCity = cityName(lead, 'municipality', 'city');
  const homeCity = cityName(homeowner, 'municipality', 'city');
  if (leadStreet !== '' && leadStreet === homeStreet && leadCity !== '' && leadCity === homeCity) return homePoint;
  return leadPoint;
}

function gpsResponse(decision: GpsDecision): Record<string, unknown> {
  const gps: Record<string, unknown> = {
    reasonCode: decision.gpsVerified ? null : 'gps_unverified_flagged',
    outcome: decision.gpsVerified ? null : 'flagged_accepted',
    gpsVerified: decision.gpsVerified,
  };
  if (decision.gpsUnverifiedReason) gps.gpsUnverifiedReason = decision.gpsUnverifiedReason;
  if (decision.gpsDistanceM != null) gps.gpsDistanceM = decision.gpsDistanceM;
  return gps;
}

function millisOf(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'object') {
    const stamp = value as { toMillis?: () => number; seconds?: unknown; nanoseconds?: unknown };
    if (typeof stamp.toMillis === 'function') {
      try {
        const ms = stamp.toMillis();
        if (Number.isFinite(ms)) return ms;
      } catch {
        return null;
      }
    }
    if (typeof stamp.seconds === 'number' && Number.isFinite(stamp.seconds)) {
      const nanos = typeof stamp.nanoseconds === 'number' && Number.isFinite(stamp.nanoseconds) ? stamp.nanoseconds : 0;
      return stamp.seconds * 1000 + Math.floor(nanos / 1e6);
    }
  }
  return null;
}

function sameTap(entry: unknown, uid: string, disposition: string, actionAtMs: number): boolean {
  if (!isPlainObject(entry)) return false;
  if (entry.userId !== uid || entry.disposition !== disposition) return false;
  return millisOf(entry.timestamp) === actionAtMs;
}

function mergeHistory(
  existing: unknown,
  entry: Record<string, unknown>,
  uid: string,
  disposition: string,
  actionAtMs: number,
): { history: unknown[]; changed: boolean; dropped: number } {
  const list = Array.isArray(existing) ? existing.slice() : [];
  if (list.some((item) => sameTap(item, uid, disposition, actionAtMs))) {
    return { history: list, changed: false, dropped: 0 };
  }
  let index = list.length;
  for (let i = 0; i < list.length; i += 1) {
    const ms = millisOf(isPlainObject(list[i]) ? list[i].timestamp : undefined);
    if (ms == null || ms < actionAtMs) {
      index = i;
      break;
    }
  }
  list.splice(index, 0, entry);
  if (list.length <= HISTORY_CAP) return { history: list, changed: true, dropped: 0 };
  let capped = list.slice(0, HISTORY_CAP);
  if (!capped.includes(entry)) {
    capped = list.slice(0, HISTORY_CAP - 1);
    capped.push(entry);
  }
  return { history: capped, changed: true, dropped: list.length - capped.length };
}

function serverNotes(lead: Record<string, unknown>): string {
  return typeof lead.notes === 'string' ? lead.notes : '';
}

function storedResponse(snap: DispoSnap, draft: ParsedDraft): { body: Record<string, unknown>; mismatch: boolean } | null {
  const data = snap.data() ?? {};
  if (!isPlainObject(data.response)) return null;
  const mismatch = data.leadId !== draft.leadId || data.kind !== draft.kind;
  return { body: { ...data.response, duplicate: true }, mismatch };
}

function receiptBody(draft: ParsedDraft, result: string, extra: Record<string, unknown>): Record<string, unknown> {
  return { ok: true, draftId: draft.draftId, result, duplicate: false, ...extra };
}

function withinReceiptLimit(body: Record<string, unknown>): boolean {
  return Buffer.byteLength(JSON.stringify(body), 'utf8') <= RECEIPT_RESPONSE_MAX_BYTES;
}

export async function handleFieldDispo(input: {
  authorization: string | null;
  rawBody?: string;
  body?: unknown;
  bodyBytes?: number;
  deps: FieldDispoDeps;
}): Promise<FieldDispoResult> {
  let approved;
  try {
    approved = await requireApprovedUser(input.authorization, input.deps);
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 401) return finish(401, { ok: false, error: 'unauthenticated' });
      return forbidden('permission_denied');
    }
    throw error;
  }
  if (!assertFieldWriter(approved.user)) return forbidden('permission_denied');
  if (isBlockedTestAccount(approved.uid, approved.user)) return forbidden('permission_denied');

  const now = input.deps.now?.() ?? Date.now();
  const store = input.deps.rateLimitStore ?? HITS;
  if (!allowFieldDispo(approved.uid, now, store)) {
    const retryAfterSeconds = fieldDispoRetryAfterSeconds(approved.uid, now, store);
    return finish(
      429,
      { ok: false, error: 'rate_limited', retryAfterSeconds },
      { 'Retry-After': String(retryAfterSeconds) },
    );
  }

  const bodyBytes = typeof input.bodyBytes === 'number'
    ? input.bodyBytes
    : typeof input.rawBody === 'string'
      ? Buffer.byteLength(input.rawBody, 'utf8')
      : 0;
  if (bodyBytes > FIELD_DISPO_NOTES_BODY_MAX) {
    return notesPayload(input.rawBody, input.body) ? payloadTooLarge() : tooLarge();
  }

  let payload = input.body;
  if (typeof input.rawBody === 'string') {
    try {
      payload = JSON.parse(input.rawBody);
    } catch {
      if (bodyBytes > FIELD_DISPO_MAX_BYTES) return tooLarge();
      return invalid('body');
    }
  }
  if (isPlainObject(payload) && payload.kind === 'notes') {
    if (notesTextOverMax(payload)) return payloadTooLarge();
  } else if (bodyBytes > FIELD_DISPO_MAX_BYTES) {
    return tooLarge();
  }
  const parsed = parseDraft(payload, now);
  if (!parsed.ok) return invalid(parsed.field);

  const draft = parsed.draft;
  const outcome = await input.deps.db.runTransaction((tx) => applyDraft({
    tx,
    db: input.deps.db,
    deps: input.deps,
    uid: approved.uid,
    role: approved.role,
    draft,
  }));
  if (outcome.mismatch) console.log('[field/dispo] duplicate_mismatch 1');
  if (outcome.historyDropped && outcome.historyDropped > 0) {
    console.log(`[field/dispo] history_capped ${outcome.historyDropped}`);
  }
  return finish(outcome.status, outcome.body);
}

async function loadHomeowner(
  db: DispoDb,
  tx: DispoTransaction,
  draft: ParsedKnock,
): Promise<Record<string, unknown> | null> {
  if (!draft.homeownerId || draft.gps === 'absent' || draft.gps === 'malformed') return null;
  const snap = await tx.get(db.collection('homeowners').doc(draft.homeownerId));
  if (!snap.exists) return null;
  return snap.data() ?? null;
}

async function applyDraft(input: {
  tx: DispoTransaction;
  db: DispoDb;
  deps: FieldDispoDeps;
  uid: string;
  role: string;
  draft: ParsedDraft;
}): Promise<TxOutcome> {
  const receiptId = `${input.uid}_${input.draft.draftId}`;
  const receiptRef = input.db.collection('fieldDispoReceipts').doc(receiptId);
  const receiptSnap = await input.tx.get(receiptRef);
  if (receiptSnap.exists) {
    const stored = storedResponse(receiptSnap, input.draft);
    if (!stored) throw new Error('Dispo receipt is unreadable');
    return { status: 200, body: stored.body, mismatch: stored.mismatch };
  }

  const leadRef = input.db.collection('leads').doc(input.draft.leadId);
  const leadSnap = await input.tx.get(leadRef);
  if (!leadSnap.exists) {
    return { status: 410, body: { ok: false, error: 'not_found', reasonCode: 'not_found' } };
  }
  const lead = leadSnap.data() ?? {};
  if (lead.historicalTerritoryPin === true) {
    return { status: 403, body: { ok: false, error: 'forbidden', reasonCode: 'historical_pin' } };
  }
  if (lead.testData === true || lead.isExcludedTestLead === true) {
    return { status: 403, body: { ok: false, error: 'forbidden', reasonCode: 'permission_denied' } };
  }

  const staff = input.role === 'admin' || input.role === 'manager';
  const owned = ownsLead(lead, input.uid);
  let callerTerritories: { docs: DispoSnap[]; truncated: boolean } | null = null;
  const loadCallerTerritories = async () => {
    if (!callerTerritories) callerTerritories = await loadTerritories(input.db, input.tx, input.uid);
    return callerTerritories;
  };
  if (!staff && !owned) {
    const territoryMine = await territoryOwnedByDirectRead(input.db, input.tx, lead.territoryId, input.uid);
    if (!territoryMine) {
      if (isOther(lead.claimedBy, input.uid) || isOther(lead.assignedTo, input.uid)) {
        return { status: 403, body: { ok: false, error: 'forbidden', reasonCode: 'owned_by_other' } };
      }
      const coords = leadCoords(lead);
      const loaded = await loadCallerTerritories();
      const inside = coords ? insideCallerPolygon(loaded.docs, coords.lat, coords.lng, input.uid) : false;
      if (!inside) {
        return { status: 403, body: { ok: false, error: 'forbidden', reasonCode: 'out_of_territory' } };
      }
    }
  }

  if (input.draft.kind === 'notes') return applyNotes(input, leadRef, receiptRef, lead);
  const homeowner = await loadHomeowner(input.db, input.tx, input.draft);
  const polygons = await areaPolygonsFor(input, loadCallerTerritories);
  return applyKnock(input, input.draft, leadRef, receiptRef, lead, homeowner, polygons);
}

/**
 * Area is a flag, never a 403. Admin and manager are exempt. A missing fix
 * has no position to test. A truncated territory list is an unknown area, so
 * it does not flag out_of_area. A rep with no counted polygon is not flagged.
 */
async function areaPolygonsFor(
  input: {
    uid: string;
    role: string;
    draft: ParsedDraft;
  },
  loadCallerTerritories: () => Promise<{ docs: DispoSnap[]; truncated: boolean }>,
): Promise<AreaPolygons | undefined> {
  if (input.draft.kind !== 'knock') return undefined;
  if (input.draft.gps === 'absent' || input.draft.gps === 'malformed') return undefined;
  if (isAreaExemptRole(input.role)) return undefined;
  const loaded = await loadCallerTerritories();
  if (loaded.truncated) return 'unknown';
  return countedPolygons(loaded.docs, input.uid);
}

function writeReceipt(
  tx: DispoTransaction,
  receiptRef: DispoDocRef,
  deps: FieldDispoDeps,
  uid: string,
  draft: ParsedDraft,
  result: string,
  body: Record<string, unknown>,
): void {
  if (!withinReceiptLimit(body)) throw new Error('Dispo receipt response is too large');
  tx.create(receiptRef, {
    uid,
    draftId: draft.draftId,
    leadId: draft.leadId,
    kind: draft.kind,
    result,
    response: { ...body },
    createdAt: deps.serverTimestamp(),
  });
}

function applyNotes(
  input: {
    tx: DispoTransaction;
    deps: FieldDispoDeps;
    uid: string;
    draft: ParsedDraft;
  },
  leadRef: DispoDocRef,
  receiptRef: DispoDocRef,
  lead: Record<string, unknown>,
): TxOutcome {
  const draft = input.draft;
  if (draft.kind !== 'notes') throw new Error('Dispo notes draft missing');
  const current = serverNotes(lead);
  if (current !== draft.baseNotes && current !== draft.notes) {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'conflict',
        reasonCode: 'notes_conflict',
        currentNotes: current,
        serverUpdatedFields: ['notes'],
      },
    };
  }
  const body = receiptBody(draft, 'applied', {});
  if (current !== draft.notes) {
    const patch = { notes: draft.notes };
    assertAllowedPatch(patch);
    input.tx.update(leadRef, patch);
  }
  writeReceipt(input.tx, receiptRef, input.deps, input.uid, draft, 'applied', body);
  return { status: 200, body };
}

function applyKnock(
  input: {
    tx: DispoTransaction;
    deps: FieldDispoDeps;
    uid: string;
    role: string;
  },
  draft: ParsedKnock,
  leadRef: DispoDocRef,
  receiptRef: DispoDocRef,
  lead: Record<string, unknown>,
  homeowner: Record<string, unknown> | null,
  polygons: AreaPolygons | undefined,
): TxOutcome {
  const decision = decideKnockGps({
    fix: draft.gps,
    actionAtMs: draft.actionAtMs,
    reference: referencePoint(lead, homeowner),
    role: input.role,
    polygons,
  });
  const serverMs = millisOf(lead.dispositionedAt);
  const stale = serverMs != null && draft.actionAtMs <= serverMs;
  const entry = {
    disposition: draft.disposition,
    timestamp: input.deps.Timestamp.fromMillis(draft.actionAtMs),
    userId: input.uid,
    userName: draft.userName,
    gpsFlag: gpsFlagOf(decision),
  };
  const history = mergeHistory(lead.dispositionHistory, entry, input.uid, draft.disposition, draft.actionAtMs);
  const patch: Record<string, unknown> = {};
  if (history.changed) patch.dispositionHistory = history.history;

  if (!stale) {
    const clear = () => input.deps.deleteField();
    patch.status = draft.status;
    patch.disposition = draft.disposition;
    patch.dispositionedAt = input.deps.Timestamp.fromMillis(draft.actionAtMs);
    patch.gpsVerified = decision.gpsVerified;
    // Clients send other only for a usable fix whose lead has no coordinates.
    patch.gpsUnverifiedReason = decision.gpsUnverifiedReason ?? clear();
    patch.gpsDistanceM = decision.gpsDistanceM ?? clear();
    if (decision.keepFix && draft.gps !== 'absent' && draft.gps !== 'malformed') {
      patch.knockGpsLat = draft.gps.lat;
      patch.knockGpsLng = draft.gps.lng;
      patch.knockGpsAccuracy = draft.gps.accuracyM;
      patch.knockGpsTimestamp = input.deps.Timestamp.fromMillis(draft.gps.capturedAtMs);
      patch.knockDistanceFromAddress = decision.gpsDistanceM ?? clear();
    } else {
      patch.knockGpsLat = clear();
      patch.knockGpsLng = clear();
      patch.knockGpsAccuracy = clear();
      patch.knockGpsTimestamp = clear();
      patch.knockDistanceFromAddress = clear();
    }
    if (draft.goBack) {
      patch.goBackScheduledDate = input.deps.Timestamp.fromMillis(draft.goBack.scheduledDateMs);
      patch.goBackScheduledTime = draft.goBack.scheduledTime;
      patch.goBackNotes = draft.goBack.notes;
      patch.goBackScheduledBy = input.uid;
    }
    if (draft.objection) {
      patch.objectionType = draft.objection.type;
      patch.objectionNotes = draft.objection.notes;
      patch.objectionRecordedAt = input.deps.Timestamp.fromMillis(draft.actionAtMs);
      patch.objectionRecordedBy = input.uid;
    }
  }

  assertAllowedPatch(patch);
  if (Object.keys(patch).length > 0) input.tx.update(leadRef, patch);

  const body = stale
    ? receiptBody(draft, 'stale_history_only', {
      reasonCode: 'stale_tap',
      serverDispositionedAt: new Date(serverMs as number).toISOString(),
    })
    : receiptBody(draft, 'applied', { gps: gpsResponse(decision) });
  writeReceipt(input.tx, receiptRef, input.deps, input.uid, draft, stale ? 'stale_history_only' : 'applied', body);
  return { status: 200, body, historyDropped: history.dropped };
}
