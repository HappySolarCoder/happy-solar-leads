import {
  HttpError,
  requireApprovedUser,
  type ApprovedUser,
  type RequireApprovedUserDeps,
  type UserProfile,
} from './requireApprovedUser';
import { isTestAccount } from './discordNotification';
import { FIELD_REASON_CODES } from './fieldReasonCodes';

export const SYNC_REPORT_LIMIT = 10;
export const SYNC_REPORT_WINDOW_MS = 60_000;
export const SYNC_REPORT_MAX_BYTES = 64 * 1024;
export const SYNC_REPORT_MAX_BATCH = 50;
export const SYNC_REPORT_LIST_DEFAULT = 50;
export const SYNC_REPORT_LIST_MAX = 100;
export const SYNC_REPORT_DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const SYNC_REPORT_MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

const ACTION_AT_PAST_MS = 30 * 24 * 60 * 60 * 1000;
const ACTION_AT_FUTURE_MS = 24 * 60 * 60 * 1000;
const LAST_ERROR_MAX = 500;
const NAME_MAX = 120;

const FIELD_ROLES = new Set(['admin', 'manager', 'setter', 'closer']);
const LIST_ROLES = new Set(['admin', 'manager']);

const REASON_CODES = new Set<string>(FIELD_REASON_CODES);

const OUTCOMES = new Set(['refused', 'flagged_accepted']);

const ITEM_KEYS = new Set([
  'draftId',
  'leadId',
  'intendedStatus',
  'actionAt',
  'reasonCode',
  'outcome',
  'appBuild',
  'lastError',
  'gpsAccuracyM',
  'distanceM',
]);

/**
 * Opaque mobile draft id. 14.x drafts are crypto.randomUUID(); older drafts
 * may be any id of this shape. Same regex as /api/field/dispo.
 */
const DRAFT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[Tt]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:[Zz]|[+-]\d{2}:\d{2}))?$/;

export type RateLimitStore = Map<string, number[]>;

/**
 * Per-instance, in-memory, best effort. Each server process keeps its own
 * window, so the limit is not shared across instances.
 */
const HITS: RateLimitStore = new Map();

export type SyncQuery = {
  where: (field: string, op: string, value: unknown) => SyncQuery;
  orderBy: (field: string, direction: 'asc' | 'desc') => SyncQuery;
  limit: (n: number) => SyncQuery;
  startAfter: (snapshot: unknown) => SyncQuery;
  get: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }>;
};

export type SyncDocRef = {
  create: (data: Record<string, unknown>) => Promise<void>;
  get: () => Promise<{
    exists: boolean;
    id: string;
    snapshot: unknown;
    data: () => Record<string, unknown> | undefined;
  }>;
};

export type SyncCollection = SyncQuery & {
  doc: (id: string) => SyncDocRef;
};

export type FieldSyncReportDeps = RequireApprovedUserDeps & {
  now?: () => number;
  rateLimitStore?: RateLimitStore;
  toTimestamp: (millis: number) => unknown;
  serverTimestamp: () => unknown;
  collection: (name: string) => SyncCollection;
};

export type SyncReportResult = {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  logCount: number;
};

type ReportItem = {
  draftId: string;
  leadId: string;
  intendedStatus: string;
  actionAtMs: number;
  reasonCode: string;
  outcome: string;
  appBuild: string;
  lastError?: string;
  gpsAccuracyM?: number;
  distanceM?: number;
};

export function resetSyncReportRateLimit(): void {
  HITS.clear();
}

export function allowSyncReport(
  uid: string,
  now: number,
  store: RateLimitStore = HITS,
  limit = SYNC_REPORT_LIMIT,
  windowMs = SYNC_REPORT_WINDOW_MS,
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
export function syncReportRetryAfterSeconds(
  uid: string,
  now: number,
  store: RateLimitStore = HITS,
  windowMs = SYNC_REPORT_WINDOW_MS,
): number {
  const recent = (store.get(uid) ?? []).filter((at) => now - at < windowMs);
  if (recent.length === 0) return Math.ceil(windowMs / 1000);
  const oldest = Math.min(...recent);
  return Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
}

/**
 * Same active-profile predicate as firestore.rules profileApprovedActive(),
 * checked strictly. Missing flags do not default to allowed.
 */
export function assertFieldReporter(user: UserProfile): void {
  const role = typeof user.role === 'string' ? user.role : '';
  if (!FIELD_ROLES.has(role)) throw new HttpError(403, 'This account is not approved.');
  if (user.isActive !== true) throw new HttpError(403, 'This account is not approved.');
  if (user.approved !== true) throw new HttpError(403, 'This account is not approved.');
  if (user.approvalStatus !== 'approved') throw new HttpError(403, 'This account is not approved.');
  if (user.status !== 'active') throw new HttpError(403, 'This account is not approved.');
  if (user.deleted === true || user.deletionPending === true || user.deletedAt != null) {
    throw new HttpError(403, 'This account is not approved.');
  }
}

function isBlockedTestAccount(uid: string, user: UserProfile): boolean {
  if (isTestAccount(uid, user)) return true;
  return user.team === 'TEST';
}

/** Same predicate as validId in app/utils/server/mobileLeads.ts. */
function validLeadId(id: string): boolean {
  return id.length > 0 && id.length <= 1500 && !id.includes('/') && id !== '.' && id !== '..';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalid(field: string, index?: number): SyncReportResult {
  const body: Record<string, unknown> = { error: 'Invalid report', field };
  if (index !== undefined) body.index = index;
  return { status: 400, body, logCount: 0 };
}

function cleanLastError(value: string): string {
  const stripped = value.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '');
  return stripped.slice(0, LAST_ERROR_MAX);
}

function snapshotName(user: UserProfile): string {
  if (typeof user.name !== 'string') return '';
  return user.name.trim().slice(0, NAME_MAX);
}

function parseActionAt(value: unknown, now: number): number | null {
  let ms: number;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) return null;
    ms = value;
  } else if (typeof value === 'string') {
    ms = Date.parse(value);
    if (!Number.isFinite(ms)) return null;
  } else {
    return null;
  }
  if (ms < now - ACTION_AT_PAST_MS || ms > now + ACTION_AT_FUTURE_MS) return null;
  return ms;
}

function parseOptionalMeters(value: unknown): number | undefined | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000) return null;
  return value;
}

function validateItem(item: unknown, now: number): { ok: true; value: ReportItem } | { ok: false; field: string } {
  if (!isPlainObject(item)) return { ok: false, field: 'reports' };
  for (const key of Object.keys(item)) {
    if (!ITEM_KEYS.has(key)) return { ok: false, field: key };
  }

  if (typeof item.draftId !== 'string' || !DRAFT_ID_RE.test(item.draftId)) {
    return { ok: false, field: 'draftId' };
  }
  if (typeof item.leadId !== 'string' || !validLeadId(item.leadId)) {
    return { ok: false, field: 'leadId' };
  }
  if (typeof item.intendedStatus !== 'string') return { ok: false, field: 'intendedStatus' };
  const intendedStatus = item.intendedStatus.trim();
  if (intendedStatus.length < 1 || intendedStatus.length > 64) {
    return { ok: false, field: 'intendedStatus' };
  }
  const actionAtMs = parseActionAt(item.actionAt, now);
  if (actionAtMs === null) return { ok: false, field: 'actionAt' };
  if (typeof item.reasonCode !== 'string' || !REASON_CODES.has(item.reasonCode)) {
    return { ok: false, field: 'reasonCode' };
  }
  if (typeof item.outcome !== 'string' || !OUTCOMES.has(item.outcome)) {
    return { ok: false, field: 'outcome' };
  }
  if (typeof item.appBuild !== 'string' || item.appBuild.length < 1 || item.appBuild.length > 32) {
    return { ok: false, field: 'appBuild' };
  }

  const value: ReportItem = {
    draftId: item.draftId,
    leadId: item.leadId,
    intendedStatus,
    actionAtMs,
    reasonCode: item.reasonCode,
    outcome: item.outcome,
    appBuild: item.appBuild,
  };

  if (Object.prototype.hasOwnProperty.call(item, 'lastError')) {
    if (typeof item.lastError !== 'string') return { ok: false, field: 'lastError' };
    value.lastError = cleanLastError(item.lastError);
  }
  if (Object.prototype.hasOwnProperty.call(item, 'gpsAccuracyM')) {
    const meters = parseOptionalMeters(item.gpsAccuracyM);
    if (meters === null) return { ok: false, field: 'gpsAccuracyM' };
    value.gpsAccuracyM = meters;
  }
  if (Object.prototype.hasOwnProperty.call(item, 'distanceM')) {
    const meters = parseOptionalMeters(item.distanceM);
    if (meters === null) return { ok: false, field: 'distanceM' };
    value.distanceM = meters;
  }
  return { ok: true, value };
}

function parseReports(body: unknown, now: number): { ok: true; items: ReportItem[] } | { ok: false; result: SyncReportResult } {
  if (!isPlainObject(body)) return { ok: false, result: invalid('body') };
  for (const key of Object.keys(body)) {
    if (key !== 'reports') return { ok: false, result: invalid(key) };
  }
  if (!Array.isArray(body.reports) || body.reports.length < 1 || body.reports.length > SYNC_REPORT_MAX_BATCH) {
    return { ok: false, result: invalid('reports') };
  }

  const items: ReportItem[] = [];
  for (let index = 0; index < body.reports.length; index += 1) {
    const parsed = validateItem(body.reports[index], now);
    if (!parsed.ok) return { ok: false, result: invalid(parsed.field, index) };
    items.push(parsed.value);
  }

  const seen = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const draftId = items[index].draftId;
    if (seen.has(draftId)) return { ok: false, result: invalid('draftId', index) };
    seen.add(draftId);
  }
  return { ok: true, items };
}

function isAlreadyExists(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === 6 || code === '6' || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

function isIndexBuilding(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === 9 || code === '9' || code === 'failed-precondition' || code === 'FAILED_PRECONDITION';
}

async function authorize(
  authorization: string | null,
  deps: FieldSyncReportDeps,
  kind: 'post' | 'list',
): Promise<{ ok: true; approved: ApprovedUser } | { ok: false; result: SyncReportResult }> {
  try {
    const approved = await requireApprovedUser(authorization, deps);
    assertFieldReporter(approved.user);
    if (isBlockedTestAccount(approved.uid, approved.user)) {
      const error = kind === 'post'
        ? 'Test accounts cannot send reports.'
        : 'Test accounts cannot view reports.';
      return { ok: false, result: { status: 403, body: { error }, logCount: 0 } };
    }
    if (kind === 'list' && !LIST_ROLES.has(approved.role)) {
      return { ok: false, result: { status: 403, body: { error: 'Not allowed.' }, logCount: 0 } };
    }
    return { ok: true, approved };
  } catch (error) {
    if (error instanceof HttpError) {
      return { ok: false, result: { status: error.status, body: { error: error.message }, logCount: 0 } };
    }
    throw error;
  }
}

function buildDoc(item: ReportItem, approved: ApprovedUser, deps: FieldSyncReportDeps): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    draftId: item.draftId,
    leadId: item.leadId,
    intendedStatus: item.intendedStatus,
    actionAt: deps.toTimestamp(item.actionAtMs),
    reasonCode: item.reasonCode,
    outcome: item.outcome,
    appBuild: item.appBuild,
    uid: approved.uid,
    userRole: approved.role,
    userName: snapshotName(approved.user),
    createdAt: deps.serverTimestamp(),
    schemaVersion: 1,
  };
  if (item.lastError !== undefined) doc.lastError = item.lastError;
  if (item.gpsAccuracyM !== undefined) doc.gpsAccuracyM = item.gpsAccuracyM;
  if (item.distanceM !== undefined) doc.distanceM = item.distanceM;
  return doc;
}

async function createOne(
  id: string,
  data: Record<string, unknown>,
  deps: FieldSyncReportDeps,
): Promise<'created' | 'duplicate' | 'failed'> {
  try {
    await deps.collection('fieldSyncReports').doc(id).create(data);
    return 'created';
  } catch (error) {
    if (isAlreadyExists(error)) return 'duplicate';
    return 'failed';
  }
}

function resolveJsonBody(input: { rawBody?: string; body?: unknown }):
  | { ok: true; value: unknown }
  | { ok: false; result: SyncReportResult } {
  if (typeof input.rawBody === 'string') {
    if (Buffer.byteLength(input.rawBody, 'utf8') > SYNC_REPORT_MAX_BYTES) {
      return { ok: false, result: { status: 413, body: { error: 'Payload too large' }, logCount: 0 } };
    }
    try {
      return { ok: true, value: JSON.parse(input.rawBody) };
    } catch {
      return { ok: false, result: invalid('body') };
    }
  }
  return { ok: true, value: input.body };
}

export async function handleFieldSyncReportPost(input: {
  authorization: string | null;
  rawBody?: string;
  body?: unknown;
  deps: FieldSyncReportDeps;
}): Promise<SyncReportResult> {
  const auth = await authorize(input.authorization, input.deps, 'post');
  if (!auth.ok) return auth.result;

  const now = input.deps.now?.() ?? Date.now();
  const store = input.deps.rateLimitStore ?? HITS;
  if (!allowSyncReport(auth.approved.uid, now, store)) {
    return {
      status: 429,
      body: { error: 'Too many reports' },
      headers: { 'Retry-After': String(syncReportRetryAfterSeconds(auth.approved.uid, now, store)) },
      logCount: 0,
    };
  }

  const payload = resolveJsonBody(input);
  if (!payload.ok) return payload.result;

  const parsed = parseReports(payload.value, now);
  if (!parsed.ok) return parsed.result;

  const outcomes = await Promise.all(parsed.items.map((item) => {
    const id = `${auth.approved.uid}_${item.draftId}`;
    return createOne(id, buildDoc(item, auth.approved, input.deps), input.deps);
  }));

  const created = outcomes.filter((outcome) => outcome === 'created').length;
  const duplicate = outcomes.filter((outcome) => outcome === 'duplicate').length;
  const failed = outcomes.filter((outcome) => outcome === 'failed').length;
  const logCount = outcomes.length;
  if (failed === outcomes.length) {
    return { status: 500, body: { ok: false, created, duplicate, failed }, logCount };
  }
  return { status: 200, body: { ok: true, created, duplicate, failed }, logCount };
}

function parseIsoDate(value: string): number | null {
  if (!ISO_DATE_RE.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return ms;
}

function parseLimit(raw: string | null): number | null {
  if (raw == null) return SYNC_REPORT_LIST_DEFAULT;
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const limit = Number(raw);
  if (limit < 1 || limit > SYNC_REPORT_LIST_MAX) return null;
  return limit;
}

function validCursor(value: string): boolean {
  if (value.length < 1 || value.length > 400) return false;
  if (value === '.' || value === '..') return false;
  if (value.includes('/')) return false;
  if (/[\u0000-\u001F\u007F]/.test(value)) return false;
  return true;
}

function queryInvalid(field: string): SyncReportResult {
  return { status: 400, body: { error: 'Invalid query', field }, logCount: 0 };
}

function parseWindow(params: URLSearchParams, now: number):
  | { ok: true; fromMs: number; toMs: number }
  | { ok: false; result: SyncReportResult } {
  const fromRaw = params.get('from');
  const toRaw = params.get('to');
  const fromMs = fromRaw == null ? null : parseIsoDate(fromRaw);
  const toMs = toRaw == null ? null : parseIsoDate(toRaw);
  if (fromRaw != null && fromMs === null) return { ok: false, result: queryInvalid('from') };
  if (toRaw != null && toMs === null) return { ok: false, result: queryInvalid('to') };

  let from = fromMs;
  let to = toMs;
  if (from == null && to == null) {
    to = now;
    from = now - SYNC_REPORT_DEFAULT_WINDOW_MS;
  } else if (from == null && to != null) {
    from = to - SYNC_REPORT_DEFAULT_WINDOW_MS;
  } else if (from != null && to == null) {
    to = now;
  }
  if (from == null || to == null || !(to > from) || to - from > SYNC_REPORT_MAX_WINDOW_MS) {
    return { ok: false, result: queryInvalid('from') };
  }
  return { ok: true, fromMs: from, toMs: to };
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && 'toDate' in value) {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate === 'function') {
      try {
        return (toDate as () => Date).call(value).toISOString();
      } catch {
        return null;
      }
    }
  }
  return value;
}

export async function handleFieldSyncReportGet(input: {
  authorization: string | null;
  searchParams: URLSearchParams;
  deps: FieldSyncReportDeps;
}): Promise<SyncReportResult> {
  const auth = await authorize(input.authorization, input.deps, 'list');
  if (!auth.ok) return auth.result;

  const limit = parseLimit(input.searchParams.get('limit'));
  if (limit === null) return queryInvalid('limit');

  const reasonRaw = input.searchParams.get('reasonCode');
  if (reasonRaw != null && !REASON_CODES.has(reasonRaw)) return queryInvalid('reasonCode');

  const now = input.deps.now?.() ?? Date.now();
  const window = parseWindow(input.searchParams, now);
  if (!window.ok) return window.result;

  const cursor = input.searchParams.get('cursor');
  if (cursor != null && !validCursor(cursor)) return queryInvalid('cursor');

  let query: SyncQuery = input.deps.collection('fieldSyncReports');
  if (reasonRaw) query = query.where('reasonCode', '==', reasonRaw);
  query = query
    .where('createdAt', '>=', input.deps.toTimestamp(window.fromMs))
    .where('createdAt', '<', input.deps.toTimestamp(window.toMs))
    .orderBy('createdAt', 'desc');

  if (cursor) {
    const snap = await input.deps.collection('fieldSyncReports').doc(cursor).get();
    if (!snap.exists) return queryInvalid('cursor');
    query = query.startAfter(snap.snapshot);
  }
  query = query.limit(limit);

  let page: { docs: Array<{ id: string; data: () => Record<string, unknown> }> };
  try {
    page = await query.get();
  } catch (error) {
    if (isIndexBuilding(error)) {
      return { status: 503, body: { error: 'Index building' }, logCount: 0 };
    }
    throw error;
  }

  const items = page.docs.map((doc) => {
    const data = doc.data() ?? {};
    const item: Record<string, unknown> = { id: doc.id };
    for (const [key, value] of Object.entries(data)) {
      if (key === 'id') continue;
      item[key] = serializeValue(value);
    }
    return item;
  });
  const nextCursor = items.length === limit ? page.docs[page.docs.length - 1]?.id ?? null : null;
  return {
    status: 200,
    body: { items, nextCursor },
    logCount: items.length,
  };
}
