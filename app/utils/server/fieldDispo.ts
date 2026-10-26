import assert from 'node:assert/strict';
import { distanceBetween } from 'geofire-common';
import { insideTerritory, territoryBounds } from '@/app/utils/territoryManager';
import { isProximityRequired, PROXIMITY_MAX_DISTANCE_METERS } from '@/app/utils/proximityEnforcement';
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
export const TERRITORY_QUERY_LIMIT = 200;
export const HISTORY_CAP = 500;
const RECEIPT_RESPONSE_MAX_BYTES = 2048;
const ACTION_PAST_MS = 30 * 24 * 60 * 60 * 1000;
const ACTION_FUTURE_MS = 10 * 60 * 1000;
const GOBACK_PAST_MS = 24 * 60 * 60 * 1000;
const GOBACK_FUTURE_MS = 366 * 24 * 60 * 60 * 1000;
const GPS_BEFORE_MS = 5_000;
const GPS_AFTER_MS = 15_000;
const DISTANCE_MAX_M = 100_000;

/**
 * Evan has not picked a policy. `hold` matches the phone today.
 * This is a code constant, not an environment variable.
 */
export const FIELD_DISPO_GPS_POLICY: 'hold' | 'flag' = 'hold';
export type FieldDispoGpsPolicy = 'hold' | 'flag';

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
  /** Tests only. Production leaves this unset and uses FIELD_DISPO_GPS_POLICY. */
  gpsPolicy?: FieldDispoGpsPolicy;
  Timestamp: TimestampFactory;
  serverTimestamp: () => unknown;
};

export type FieldDispoResult = {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

type GpsFix = {
  lat: number;
  lng: number;
  accuracyM: number;
  capturedAtMs: number;
};

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
  gps: GpsFix | 'absent' | 'unusable';
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

function parseGps(value: unknown): { ok: true; gps: GpsFix | 'unusable' } | { ok: false; field: string } {
  if (!isPlainObject(value)) return { ok: false, field: 'gps' };
  const unknown = firstUnknown(value, GPS_KEYS);
  if (unknown) return { ok: false, field: `gps.${unknown}` };
  for (const key of GPS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return { ok: false, field: `gps.${key}` };
  }
  const capturedAtMs = parseIsoMillis(value.capturedAt);
  if (capturedAtMs == null) return { ok: false, field: 'gps.capturedAt' };
  const { lat, lng, accuracyM } = value;
  if (typeof lat !== 'number' || typeof lng !== 'number' || typeof accuracyM !== 'number') {
    const field = typeof lat !== 'number' ? 'gps.lat' : typeof lng !== 'number' ? 'gps.lng' : 'gps.accuracyM';
    return { ok: false, field };
  }
  const usable = Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lng) && lng >= -180 && lng <= 180
    && Number.isFinite(accuracyM) && accuracyM >= 0 && accuracyM <= DISTANCE_MAX_M;
  if (!usable) return { ok: true, gps: 'unusable' };
  return { ok: true, gps: { lat, lng, accuracyM, capturedAtMs } };
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
    const notes = boundedString(body.notes, 10000, true);
    if (notes == null) return { ok: false, field: 'notes' };
    let baseNotes = '';
    if (Object.prototype.hasOwnProperty.call(body, 'baseNotes') && body.baseNotes != null) {
      const parsedBase = boundedString(body.baseNotes, 10000, true);
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

  let gps: GpsFix | 'absent' | 'unusable' = 'absent';
  if (Object.prototype.hasOwnProperty.call(body, 'gps') && body.gps != null) {
    const parsedGps = parseGps(body.gps);
    if (!parsedGps.ok) return parsedGps;
    gps = parsedGps.gps;
  }
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

function leadCoords(lead: Record<string, unknown>): { lat: number; lng: number } | null {
  const { lat, lng } = lead;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
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
 * That predicate does not look at claimedBy, assignedTo, or archived, so a
 * territory owner can still disposition another rep's claimed or assigned pin.
 * Polygon containment is only the extra map-pin path for unowned leads, and
 * it ignores archived territories and polygons with fewer than 3 points.
 */
function territoryOwnedByCaller(docs: DispoSnap[], territoryId: unknown, uid: string): boolean {
  if (typeof territoryId !== 'string' || territoryId === '') return false;
  return docs.some((doc) => {
    if (doc.id !== territoryId) return false;
    const data = doc.data() ?? {};
    return data.userId === uid;
  });
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

async function loadTerritories(db: DispoDb, tx: DispoTransaction, uid: string): Promise<DispoSnap[]> {
  const query = db.collection('territories').where('userId', '==', uid).limit(TERRITORY_QUERY_LIMIT);
  const snap = await tx.getQuery(query);
  return snap.docs;
}

function proximitySubject(user: UserProfile): { role?: string; features?: { proximityEnforcement?: boolean } } {
  const role = typeof user.role === 'string' ? user.role : undefined;
  const features = isPlainObject(user.features) ? user.features : undefined;
  if (features?.proximityEnforcement === false) return { role, features: { proximityEnforcement: false } };
  return { role };
}

type GpsEval = {
  state: 'ok' | 'outside' | 'unverified';
  /** Present only when lat/lng/accuracy are in range. The capture window may still be closed. */
  fix: GpsFix | null;
  windowOk: boolean;
  distanceM: number | null;
};

function evaluateGps(draft: ParsedKnock, lead: Record<string, unknown>): GpsEval {
  if (draft.gps === 'absent' || draft.gps === 'unusable') {
    return { state: 'unverified', fix: null, windowOk: false, distanceM: null };
  }
  const fix = draft.gps;
  const delta = fix.capturedAtMs - draft.actionAtMs;
  const windowOk = delta >= -GPS_BEFORE_MS && delta <= GPS_AFTER_MS;
  const coords = leadCoords(lead);
  let distanceM: number | null = null;
  if (coords) {
    distanceM = distanceBetween([fix.lat, fix.lng], [coords.lat, coords.lng]) * 1000;
    if (!Number.isFinite(distanceM)) distanceM = null;
  }
  if (!windowOk || !coords || distanceM == null) {
    return { state: 'unverified', fix, windowOk, distanceM };
  }
  if (distanceM > PROXIMITY_MAX_DISTANCE_METERS) return { state: 'outside', fix, windowOk, distanceM };
  return { state: 'ok', fix, windowOk, distanceM };
}

function storeDistance(distanceM: number | null): number | null {
  if (distanceM == null || !Number.isFinite(distanceM) || distanceM < 0 || distanceM > DISTANCE_MAX_M) return null;
  return distanceM;
}

function gpsResponse(
  reasonCode: 'gps_unverified_flagged' | 'outside_50m' | null,
  distanceM: number | null,
): Record<string, unknown> {
  return {
    reasonCode,
    outcome: reasonCode ? 'flagged_accepted' : null,
    distanceM,
  };
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
  if (bodyBytes > FIELD_DISPO_MAX_BYTES) return finish(413, { ok: false, error: 'too_large' });

  let payload = input.body;
  if (typeof input.rawBody === 'string') {
    try {
      payload = JSON.parse(input.rawBody);
    } catch {
      return invalid('body');
    }
  }
  const parsed = parseDraft(payload, now);
  if (!parsed.ok) return invalid(parsed.field);

  const draft = parsed.draft;
  const policy: FieldDispoGpsPolicy = input.deps.gpsPolicy === 'flag' ? 'flag' : FIELD_DISPO_GPS_POLICY;
  const outcome = await input.deps.db.runTransaction((tx) => applyDraft({
    tx,
    db: input.deps.db,
    deps: input.deps,
    uid: approved.uid,
    role: approved.role,
    user: approved.user,
    draft,
    policy,
  }));
  if (outcome.mismatch) console.log('[field/dispo] duplicate_mismatch 1');
  if (outcome.historyDropped && outcome.historyDropped > 0) {
    console.log(`[field/dispo] history_capped ${outcome.historyDropped}`);
  }
  return finish(outcome.status, outcome.body);
}

async function applyDraft(input: {
  tx: DispoTransaction;
  db: DispoDb;
  deps: FieldDispoDeps;
  uid: string;
  role: string;
  user: UserProfile;
  draft: ParsedDraft;
  policy: FieldDispoGpsPolicy;
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
  let territories: DispoSnap[] | null = null;
  if (!staff && !owned) {
    territories = await loadTerritories(input.db, input.tx, input.uid);
    const territoryMine = territoryOwnedByCaller(territories, lead.territoryId, input.uid);
    if (!territoryMine) {
      if (isOther(lead.claimedBy, input.uid) || isOther(lead.assignedTo, input.uid)) {
        return { status: 403, body: { ok: false, error: 'forbidden', reasonCode: 'owned_by_other' } };
      }
      const coords = leadCoords(lead);
      const inside = coords ? insideCallerPolygon(territories, coords.lat, coords.lng, input.uid) : false;
      if (!inside) {
        return { status: 403, body: { ok: false, error: 'forbidden', reasonCode: 'out_of_territory' } };
      }
    }
  }

  if (input.draft.kind === 'notes') return applyNotes(input, leadRef, receiptRef, lead);
  return applyKnock(input, input.draft, leadRef, receiptRef, lead);
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
    user: UserProfile;
    policy: FieldDispoGpsPolicy;
  },
  draft: ParsedKnock,
  leadRef: DispoDocRef,
  receiptRef: DispoDocRef,
  lead: Record<string, unknown>,
): TxOutcome {
  const evaluation = evaluateGps(draft, lead);
  const required = isProximityRequired(proximitySubject(input.user));
  let flag: 'gps_unverified_flagged' | 'outside_50m' | null = null;
  let storeFix: GpsFix | null = null;
  let distanceM: number | null = null;
  // knockGpsTimestamp is only written inside the capture window. An outside-50m
  // fix is still a valid fix, so flag mode stores it and reports the distance.
  const storableFix = evaluation.fix && evaluation.windowOk ? evaluation.fix : null;

  if (!required) {
    if (evaluation.state === 'ok' || evaluation.state === 'outside') {
      storeFix = storableFix;
      distanceM = storeDistance(evaluation.distanceM);
    }
  } else if (evaluation.state === 'ok') {
    storeFix = storableFix;
    distanceM = storeDistance(evaluation.distanceM);
  } else if (input.policy === 'flag') {
    flag = evaluation.state === 'outside' ? 'outside_50m' : 'gps_unverified_flagged';
    distanceM = storeDistance(evaluation.distanceM);
    if (evaluation.state === 'outside' || storableFix) storeFix = storableFix;
  } else {
    const reason: FieldReasonCode = evaluation.state === 'outside' ? 'outside_50m' : 'gps_unverified_held';
    return { status: 403, body: { ok: false, error: 'forbidden', reasonCode: reason } };
  }

  const serverMs = millisOf(lead.dispositionedAt);
  const stale = serverMs != null && draft.actionAtMs <= serverMs;
  const entry = {
    disposition: draft.disposition,
    timestamp: input.deps.Timestamp.fromMillis(draft.actionAtMs),
    userId: input.uid,
    userName: draft.userName,
  };
  const history = mergeHistory(lead.dispositionHistory, entry, input.uid, draft.disposition, draft.actionAtMs);
  const patch: Record<string, unknown> = {};
  if (history.changed) patch.dispositionHistory = history.history;

  if (!stale) {
    patch.status = draft.status;
    patch.disposition = draft.disposition;
    patch.dispositionedAt = input.deps.Timestamp.fromMillis(draft.actionAtMs);
    if (storeFix) {
      patch.knockGpsLat = storeFix.lat;
      patch.knockGpsLng = storeFix.lng;
      patch.knockGpsAccuracy = storeFix.accuracyM;
      patch.knockGpsTimestamp = input.deps.Timestamp.fromMillis(storeFix.capturedAtMs);
      if (distanceM != null) patch.knockDistanceFromAddress = distanceM;
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
    : receiptBody(draft, 'applied', { gps: gpsResponse(flag, distanceM) });
  writeReceipt(input.tx, receiptRef, input.deps, input.uid, draft, stale ? 'stale_history_only' : 'applied', body);
  return { status: 200, body, historyDropped: history.dropped };
}
