import { HttpError, requireApprovedUser, type ApprovedUser, type RequireApprovedUserDeps, type UserProfile } from './requireApprovedUser';
import { assertFieldWriter, isBlockedTestAccount } from './fieldDispo';
import { HOT_LEADS_PAGE, isHotLeadId, isHotLeadRole } from './hotLeadContract';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const HISTORY_LIMIT = 50;
const CLAIM_MAX_BYTES = 2 * 1024;
const CLAIM_KEYS = new Set(['draftId', 'hotLeadId', 'action', 'actionAt', 'userName']);
const DRAFT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const ACTION_PAST_MS = 30 * 24 * 60 * 60 * 1000;
const ACTION_FUTURE_MS = 10 * 60 * 1000;
const CLAIM_PATCH_KEYS = new Set(['claimedBy', 'claimedByName', 'claimedAt', 'updatedAt']);

export type LatQueryCall = {
  where: Array<{ field: 'lat'; op: '>=' | '<='; value: number }>;
  orderBy: Array<'lat' | '__name__'>;
  limit: number;
  startAfter: [number, string] | null;
};

export type HotLeadRow = { id: string; data: Record<string, unknown> };

export type HotLeadStore = {
  latBand(spec: LatQueryCall): Promise<HotLeadRow[]>;
  getById(id: string): Promise<HotLeadRow | null>;
};

export type HotLeadResult = {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

export type ClaimSnap = {
  exists: boolean;
  id: string;
  data: () => Record<string, unknown> | undefined;
};

export type ClaimTx = {
  get(path: string): Promise<ClaimSnap>;
  update(path: string, data: Record<string, unknown>): void;
  create(path: string, data: Record<string, unknown>): void;
};

export type ClaimDb = {
  runTransaction<T>(fn: (tx: ClaimTx) => Promise<T>): Promise<T>;
};

export type ClaimDeps = RequireApprovedUserDeps & {
  db: ClaimDb;
  now?: () => number;
  Timestamp: { fromMillis: (ms: number) => { toMillis: () => number } };
  serverTimestamp: () => unknown;
};

type Chain<Q> = {
  where(field: string, op: string, value: number): Q;
  orderBy(field: unknown): Q;
  limit(n: number): Q;
  startAfter(lat: number, id: string): Q;
};

/**
 * Lat range only. An equality filter would need a composite index, so this
 * refuses any where that is not lat >= / lat <=.
 */
export function describeLatBand(input: {
  south: number;
  north: number;
  limit?: number;
  after?: { lat: number; id: string } | null;
}): LatQueryCall {
  return {
    where: [
      { field: 'lat', op: '>=', value: input.south },
      { field: 'lat', op: '<=', value: input.north },
    ],
    orderBy: ['lat', '__name__'],
    limit: input.limit ?? HOT_LEADS_PAGE,
    startAfter: input.after ? [input.after.lat, input.after.id] : null,
  };
}

export function applyLatBand<Q extends Chain<Q>>(query: Q, spec: LatQueryCall, documentId: unknown): Q {
  if (spec.where.some((filter) => filter.field !== 'lat' || (filter.op !== '>=' && filter.op !== '<='))) {
    throw new Error('Hot lead lat query only allows a lat range');
  }
  if (spec.limit !== HOT_LEADS_PAGE) {
    throw new Error('Hot lead page size is fixed');
  }
  let next = query;
  for (const filter of spec.where) next = next.where(filter.field, filter.op, filter.value);
  for (const field of spec.orderBy) next = next.orderBy(field === '__name__' ? documentId : field);
  next = next.limit(spec.limit);
  if (spec.startAfter) next = next.startAfter(spec.startAfter[0], spec.startAfter[1]);
  return next;
}

function finish(status: number, body: Record<string, unknown>, count = 0): HotLeadResult {
  console.log(`[hot-leads] ${status} ${count}`);
  return { status, body, headers: { ...NO_STORE } };
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stampMillis(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'object') {
    const stamp = value as { toMillis?: () => number; toDate?: () => Date; seconds?: unknown; nanoseconds?: unknown };
    if (typeof stamp.toMillis === 'function') {
      try {
        const ms = stamp.toMillis();
        if (Number.isFinite(ms)) return ms;
      } catch {
        return null;
      }
    }
    if (typeof stamp.toDate === 'function') {
      try {
        const ms = stamp.toDate().getTime();
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

function isoOrNull(value: unknown): string | null {
  const ms = stampMillis(value);
  return ms == null ? null : new Date(ms).toISOString();
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.length ? value : null;
}

function jsonLeaf(value: unknown): unknown {
  const ms = stampMillis(value);
  if (ms != null && (typeof value === 'object' || typeof value === 'string')) {
    if (typeof value === 'string' && !ISO_RE.test(value) && Number.isNaN(Date.parse(value))) return value;
    if (typeof value !== 'string' || ISO_RE.test(value) || !Number.isNaN(Date.parse(value))) {
      if (typeof value === 'object' || (typeof value === 'string' && ISO_RE.test(value))) return new Date(ms).toISOString();
    }
  }
  return value;
}

function historyEntry(value: unknown): unknown {
  if (!isPlain(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'timestamp') out[key] = isoOrNull(item);
    else if (item && typeof item === 'object') out[key] = jsonLeaf(item);
    else out[key] = item;
  }
  return out;
}

function newestHistory(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const rows = value.map((entry, index) => ({
    entry,
    index,
    ms: isPlain(entry) ? stampMillis(entry.timestamp) : null,
  }));
  rows.sort((a, b) => {
    if (a.ms == null && b.ms == null) return a.index - b.index;
    if (a.ms == null) return 1;
    if (b.ms == null) return -1;
    if (a.ms !== b.ms) return b.ms - a.ms;
    return a.index - b.index;
  });
  return rows.slice(0, HISTORY_LIMIT).map((row) => historyEntry(row.entry));
}

function contactOf(value: unknown): { name?: string; phone?: string; email?: string } | null {
  if (!isPlain(value)) return null;
  const contact: { name?: string; phone?: string; email?: string } = {};
  if (typeof value.name === 'string' && value.name) contact.name = value.name;
  if (typeof value.phone === 'string' && value.phone) contact.phone = value.phone;
  if (typeof value.email === 'string' && value.email) contact.email = value.email;
  return contact;
}

export function toHotLeadPin(id: string, data: Record<string, unknown>, detail: boolean): Record<string, unknown> {
  const ghl = isPlain(data.ghl) ? data.ghl : {};
  const pin: Record<string, unknown> = {
    id,
    lat: typeof data.lat === 'number' ? data.lat : null,
    lng: typeof data.lng === 'number' ? data.lng : null,
    address: typeof data.address === 'string' ? data.address : '',
    state: typeof data.state === 'string' ? data.state : '',
    contacts: Array.isArray(data.contacts)
      ? data.contacts.map(contactOf).filter((item): item is NonNullable<typeof item> => item != null)
      : [],
    hotStatus: typeof data.hotStatus === 'string' ? data.hotStatus : null,
    claimedBy: stringOrNull(data.claimedBy),
    claimedByName: stringOrNull(data.claimedByName),
    claimedAt: isoOrNull(data.claimedAt),
    status: stringOrNull(data.status),
    disposition: stringOrNull(data.disposition),
    dispositionedAt: isoOrNull(data.dispositionedAt),
    linkedLeadId: stringOrNull(data.linkedLeadId),
    homeownerId: stringOrNull(data.homeownerId),
    doNotCall: data.doNotCall === true,
  };
  if (typeof data.city === 'string' && data.city) pin.city = data.city;
  if (typeof data.zip === 'string' && data.zip) pin.zip = data.zip;
  const ghlStage = stringOrNull(ghl.stage);
  const ghlSource = stringOrNull(ghl.source);
  const ghlCreatedOn = isoOrNull(ghl.createdOn);
  if (ghlStage) pin.ghlStage = ghlStage;
  if (ghlSource) pin.ghlSource = ghlSource;
  if (ghlCreatedOn) pin.ghlCreatedOn = ghlCreatedOn;
  if (typeof data.notes === 'string') pin.notes = data.notes;
  if (typeof data.gpsVerified === 'boolean') pin.gpsVerified = data.gpsVerified;
  if (typeof data.gpsUnverifiedReason === 'string' && data.gpsUnverifiedReason) {
    pin.gpsUnverifiedReason = data.gpsUnverifiedReason;
  }
  if (data.testData === true) pin.testData = true;
  if (detail) pin.dispositionHistory = newestHistory(data.dispositionHistory);
  return pin;
}

function visibleToRealAccount(data: Record<string, unknown>): boolean {
  return data.testData !== true;
}

export function mapBoundsProblem(params: URLSearchParams): boolean {
  const south = Number(params.get('south'));
  const north = Number(params.get('north'));
  const west = Number(params.get('west'));
  const east = Number(params.get('east'));
  const zoom = Number(params.get('zoom'));
  if (
    ![south, north, west, east, zoom].every(Number.isFinite)
    || zoom < 15
    || north <= south
    || east <= west
    || north - south > 0.06
    || east - west > 0.09
    || south < -85
    || north > 85
    || west < -180
    || east > 180
  ) {
    return true;
  }
  const after = params.get('after');
  if (after) {
    const afterLat = Number(params.get('afterLat'));
    if (!isHotLeadId(after) || !Number.isFinite(afterLat) || afterLat < south || afterLat > north) return true;
  }
  return false;
}

function readerAllowed(user: ApprovedUser): boolean {
  if (!assertFieldWriter(user.user)) return false;
  if (!isHotLeadRole(user.role)) return false;
  if (isBlockedTestAccount(user.uid, user.user)) return false;
  return true;
}

export async function handleHotLeadsGet(input: {
  user: ApprovedUser;
  params: URLSearchParams;
  store: HotLeadStore;
}): Promise<HotLeadResult> {
  if (!readerAllowed(input.user)) return finish(403, { error: 'not_allowed' });

  const id = input.params.get('id');
  if (id != null) return readOne(input.store, id);

  if (input.params.get('mode') !== 'map') return finish(400, { error: 'invalid_bounds' });
  if (mapBoundsProblem(input.params)) return finish(400, { error: 'invalid_bounds' });

  const south = Number(input.params.get('south'));
  const north = Number(input.params.get('north'));
  const west = Number(input.params.get('west'));
  const east = Number(input.params.get('east'));
  const after = input.params.get('after');
  const spec = describeLatBand({
    south,
    north,
    after: after ? { id: after, lat: Number(input.params.get('afterLat')) } : null,
  });
  let rows: HotLeadRow[];
  try {
    rows = await input.store.latBand(spec);
  } catch {
    return finish(500, { error: 'internal' });
  }
  const hotLeads = rows
    .filter((row) => {
      const lng = row.data.lng;
      return typeof lng === 'number' && lng >= west && lng <= east && visibleToRealAccount(row.data);
    })
    .map((row) => toHotLeadPin(row.id, row.data, false));
  const last = rows.at(-1);
  const lastLat = last && typeof last.data.lat === 'number' ? last.data.lat : null;
  const nextCursor = rows.length === HOT_LEADS_PAGE && last && lastLat != null
    ? { id: last.id, lat: lastLat }
    : null;
  return finish(200, {
    hotLeads,
    nextCursor,
    capabilities: { dispo: true, claim: true },
  }, hotLeads.length);
}

async function readOne(store: HotLeadStore, id: string): Promise<HotLeadResult> {
  if (!isHotLeadId(id)) return finish(400, { error: 'invalid_bounds' });
  let row: HotLeadRow | null;
  try {
    row = await store.getById(id);
  } catch {
    return finish(500, { error: 'internal' });
  }
  if (!row || !visibleToRealAccount(row.data)) return finish(404, { error: 'not_found' });
  return finish(200, { hotLead: toHotLeadPin(row.id, row.data, true) }, 1);
}

export async function serveHotLeads(input: {
  authorization: string | null;
  params: URLSearchParams;
  deps: RequireApprovedUserDeps & { store: HotLeadStore };
  loadApprovedUser?: () => Promise<ApprovedUser>;
}): Promise<HotLeadResult> {
  try {
    const user = input.loadApprovedUser
      ? await input.loadApprovedUser()
      : await requireApprovedUser(input.authorization, input.deps);
    return await handleHotLeadsGet({ user, params: input.params, store: input.deps.store });
  } catch (error) {
    if (error instanceof HttpError) {
      return finish(error.status === 401 ? 401 : 403, {
        error: error.status === 401 ? 'unauthenticated' : 'not_allowed',
      });
    }
    return finish(500, { error: 'internal' });
  }
}

function parseIsoMillis(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function claimInvalid(field: string): HotLeadResult {
  return finish(400, { ok: false, error: 'invalid_payload', reasonCode: 'invalid_payload', field });
}

function claimForbidden(reasonCode: string): HotLeadResult {
  return finish(403, { ok: false, error: 'forbidden', reasonCode });
}

function assertClaimPatch(patch: Record<string, unknown>): void {
  if (!Object.keys(patch).every((key) => CLAIM_PATCH_KEYS.has(key))) {
    throw new Error('Claim patch left the allowlist');
  }
}

function claimName(userName: string | undefined, user: UserProfile): string {
  if (userName) return userName;
  return typeof user.name === 'string' ? user.name.slice(0, 120) : '';
}

export async function handleHotLeadClaim(input: {
  authorization: string | null;
  rawBody?: string;
  body?: unknown;
  deps: ClaimDeps;
  loadApprovedUser?: () => Promise<ApprovedUser>;
}): Promise<HotLeadResult> {
  let approved: ApprovedUser;
  try {
    approved = input.loadApprovedUser
      ? await input.loadApprovedUser()
      : await requireApprovedUser(input.authorization, input.deps);
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 401) return finish(401, { ok: false, error: 'unauthenticated' });
      return claimForbidden('permission_denied');
    }
    return finish(500, { ok: false, error: 'internal' });
  }
  if (!assertFieldWriter(approved.user) || !isHotLeadRole(approved.role)) {
    return claimForbidden('permission_denied');
  }
  if (isBlockedTestAccount(approved.uid, approved.user)) return claimForbidden('permission_denied');

  const bodyBytes = typeof input.rawBody === 'string' ? Buffer.byteLength(input.rawBody, 'utf8') : 0;
  if (bodyBytes > CLAIM_MAX_BYTES) return finish(413, { ok: false, error: 'too_large' });

  let payload = input.body;
  if (typeof input.rawBody === 'string') {
    try {
      payload = JSON.parse(input.rawBody);
    } catch {
      return claimInvalid('body');
    }
  }
  if (!isPlain(payload)) return claimInvalid('body');
  for (const key of Object.keys(payload)) {
    if (!CLAIM_KEYS.has(key)) return claimInvalid(key);
  }
  if (typeof payload.draftId !== 'string' || !DRAFT_ID_RE.test(payload.draftId)) return claimInvalid('draftId');
  if (typeof payload.hotLeadId !== 'string' || !isHotLeadId(payload.hotLeadId)) return claimInvalid('hotLeadId');
  if (payload.action !== 'claim' && payload.action !== 'release') return claimInvalid('action');
  const now = input.deps.now?.() ?? Date.now();
  const actionAtMs = parseIsoMillis(payload.actionAt);
  if (actionAtMs == null || actionAtMs < now - ACTION_PAST_MS || actionAtMs > now + ACTION_FUTURE_MS) {
    return claimInvalid('actionAt');
  }
  let userName: string | undefined;
  if (Object.prototype.hasOwnProperty.call(payload, 'userName') && payload.userName != null) {
    if (typeof payload.userName !== 'string' || payload.userName.length < 1 || payload.userName.length > 120) {
      return claimInvalid('userName');
    }
    userName = payload.userName;
  }

  const draftId = payload.draftId;
  const hotLeadId = payload.hotLeadId;
  const action = payload.action;
  const receiptPath = `fieldDispoReceipts/${approved.uid}_${draftId}`;
  const leadPath = `hotLeads/${hotLeadId}`;

  try {
    return await input.deps.db.runTransaction(async (tx) => {
      const receiptSnap = await tx.get(receiptPath);
      if (receiptSnap.exists) {
        const data = receiptSnap.data() ?? {};
        const response = isPlain(data.response) ? data.response : null;
        if (!response) throw new Error('Claim receipt is unreadable');
        const storedCollection = data.collection == null ? 'leads' : data.collection;
        const conflict = storedCollection !== 'hotLeads'
          ? 'collection'
          : data.leadId !== hotLeadId
            ? 'leadId'
            : data.kind !== 'claim'
              ? 'kind'
              : null;
        if (conflict) {
          console.log('[hot-leads] duplicate_mismatch 1');
          return finish(409, { ok: false, error: 'conflict', reasonCode: 'invalid_payload', field: conflict });
        }
        return finish(200, { ...response, duplicate: true });
      }

      const leadSnap = await tx.get(leadPath);
      if (!leadSnap.exists) return finish(404, { ok: false, error: 'not_found' });
      const lead = leadSnap.data() ?? {};
      if (lead.testData === true) return finish(404, { ok: false, error: 'not_found' });

      const claimedBy = stringOrNull(lead.claimedBy);
      const staff = approved.role === 'manager' || approved.role === 'admin';
      let result: 'applied' | 'unchanged';
      let nextClaimedBy: string | null;

      if (action === 'claim') {
        if (claimedBy && claimedBy !== approved.uid) {
          return finish(409, {
            ok: false,
            error: 'conflict',
            reasonCode: 'owned_by_other',
            claimedByName: stringOrNull(lead.claimedByName),
          });
        }
        if (claimedBy === approved.uid) {
          result = 'unchanged';
          nextClaimedBy = approved.uid;
        } else {
          const patch = {
            claimedBy: approved.uid,
            claimedByName: claimName(userName, approved.user),
            claimedAt: input.deps.Timestamp.fromMillis(actionAtMs),
            updatedAt: input.deps.serverTimestamp(),
          };
          assertClaimPatch(patch);
          tx.update(leadPath, patch);
          result = 'applied';
          nextClaimedBy = approved.uid;
        }
      } else if (!claimedBy) {
        result = 'unchanged';
        nextClaimedBy = null;
      } else if (claimedBy !== approved.uid && !staff) {
        return claimForbidden('owned_by_other');
      } else {
        const patch = {
          claimedBy: null,
          claimedByName: null,
          claimedAt: null,
          updatedAt: input.deps.serverTimestamp(),
        };
        assertClaimPatch(patch);
        tx.update(leadPath, patch);
        result = 'applied';
        nextClaimedBy = null;
      }

      const body = {
        ok: true,
        draftId,
        result,
        duplicate: false,
        claimedBy: nextClaimedBy,
      };
      tx.create(receiptPath, {
        uid: approved.uid,
        draftId,
        leadId: hotLeadId,
        kind: 'claim',
        collection: 'hotLeads',
        result,
        response: { ...body },
        createdAt: input.deps.serverTimestamp(),
      });
      return finish(200, body);
    });
  } catch {
    return finish(500, { ok: false, error: 'internal' });
  }
}
