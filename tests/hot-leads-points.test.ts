import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpError } from '../app/utils/server/requireApprovedUser';
import {
  clearHotLeadsPointsMemo,
  describePointsQuery,
  handleHotLeadsGet,
  serveHotLeads,
  toHotLeadPoint,
  HOT_LEADS_POINTS_CAP,
  HOT_LEADS_POINTS_CACHE_MS,
  HOT_LEADS_POINTS_FIELDS,
  HOT_LEADS_POINTS_QUERY_LIMIT,
  type HotLeadRow,
  type HotLeadStore,
  type LatQueryCall,
  type PointsQueryCall,
} from '../app/utils/server/hotLeads';
import { createHotLeadsGet, liveStore } from '../app/api/hot-leads/route.ts';

const SECRET_NAME = 'Test Person';
const SECRET_PHONE = '5550101';
const SECRET_EMAIL = 'test.person@example.com';
const SECRET_STREET = '10 Main Street';
const PII_KEYS = [
  'name',
  'phone',
  'email',
  'address',
  'contacts',
  'notes',
  'claimedByName',
  'street',
  'city',
  'zip',
  'firstName',
  'lastName',
  'displayName',
  'ghl',
  'dispositionHistory',
  'userName',
  'status',
];
const POINT_KEYS = ['id', 'lat', 'lng', 'hotStatus'];
const BODY_KEYS = ['ok', 'points', 'truncated', 'generatedAt'];
const MAP = 'mode=map&south=43&north=43.05&west=-77.66&east=-77.58&zoom=16';

afterEach(() => {
  clearHotLeadsPointsMemo();
});

function user(role: string, extra: Record<string, unknown> = {}) {
  return {
    uid: 'uid-1',
    role,
    user: {
      role,
      isActive: true,
      approved: true,
      approvalStatus: 'approved',
      status: 'active',
      email: 'rep@company.com',
      name: 'Jane Rep',
      ...extra,
    },
  };
}

function row(id: string, data: Record<string, unknown>): HotLeadRow {
  return { id, data };
}

function pin(partial: Record<string, unknown> = {}) {
  return {
    lat: 43.1,
    lng: -77.6,
    address: SECRET_STREET,
    state: 'NY',
    contacts: [{ name: SECRET_NAME, phone: SECRET_PHONE, email: SECRET_EMAIL }],
    notes: 'private note',
    claimedByName: SECRET_NAME,
    hotStatus: 'active',
    status: 'Knocked',
    linkedLeadId: 'lead-77',
    homeownerId: null,
    ...partial,
  };
}

function store(
  rows: HotLeadRow[],
  calls: { lat?: LatQueryCall[]; points?: PointsQueryCall[]; ids?: string[] } = {},
): HotLeadStore {
  return {
    async latBand(spec) {
      (calls.lat ??= []).push(spec);
      return rows;
    },
    async getById(id) {
      (calls.ids ??= []).push(id);
      return rows.find((item) => item.id === id) ?? null;
    },
    async pointsOverview(spec) {
      (calls.points ??= []).push(spec);
      return rows;
    },
  };
}

function assertNoPii(value: unknown, path = 'body') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPii(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    assert.equal(PII_KEYS.includes(key), false, `${path} has PII key ${key}`);
    assertNoPii(record[key], `${path}.${key}`);
  }
  const blob = JSON.stringify(record);
  assert.equal(blob.includes(SECRET_NAME), false, `${path} leaked name`);
  assert.equal(blob.includes(SECRET_PHONE), false, `${path} leaked phone`);
  assert.equal(blob.includes(SECRET_EMAIL), false, `${path} leaked email`);
  assert.equal(blob.includes(SECRET_STREET), false, `${path} leaked address`);
}

function assertPointsContract(body: Record<string, unknown>) {
  assert.deepEqual(Object.keys(body).sort(), [...BODY_KEYS].sort());
  assert.equal(body.ok, true);
  assert.equal(typeof body.truncated, 'boolean');
  assert.equal(typeof body.generatedAt, 'string');
  assert.equal(Number.isNaN(Date.parse(body.generatedAt as string)), false);
  assert.equal(Array.isArray(body.points), true);
  for (const point of body.points as Array<Record<string, unknown>>) {
    assert.deepEqual(Object.keys(point).sort(), [...POINT_KEYS].sort());
    assert.equal(typeof point.id, 'string');
    assert.equal(typeof point.lat, 'number');
    assert.equal(Number.isFinite(point.lat), true);
    assert.equal(typeof point.lng, 'number');
    assert.equal(Number.isFinite(point.lng), true);
    assert.equal(point.hotStatus === null || typeof point.hotStatus === 'string', true);
  }
  assertNoPii(body);
}

type FakeDoc = { id: string; data: Record<string, unknown> };

function fakeDb(input: {
  users?: Record<string, Record<string, unknown>>;
  hotLeads?: FakeDoc[];
  territories?: FakeDoc[];
}) {
  const reads = { users: 0, hotLeads: 0, territories: 0, select: [] as string[][], limits: [] as number[] };

  function applySelect(data: Record<string, unknown>, fields: string[] | null) {
    if (!fields) return { ...data };
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) out[field] = data[field];
    }
    return out;
  }

  function hotQuery(state: {
    filters: Array<{ field: string; op: string; value: unknown }>;
    fields: string[] | null;
    limit: number | null;
    after: [number, string] | null;
  }) {
    const self = {
      select(...fields: string[]) {
        reads.select.push([...fields]);
        return hotQuery({ ...state, fields });
      },
      where(field: string, op: string, value: unknown) {
        return hotQuery({ ...state, filters: [...state.filters, { field, op, value }] });
      },
      orderBy() {
        return self;
      },
      limit(n: number) {
        reads.limits.push(n);
        return hotQuery({ ...state, limit: n });
      },
      startAfter(lat: number, id: string) {
        return hotQuery({ ...state, after: [lat, id] });
      },
      async get() {
        let rows = [...(input.hotLeads ?? [])];
        for (const filter of state.filters) {
          rows = rows.filter((item) => {
            const value = item.data[filter.field];
            if (typeof value !== 'number' || typeof filter.value !== 'number') return false;
            if (filter.op === '>=') return value >= filter.value;
            if (filter.op === '<=') return value <= filter.value;
            return false;
          });
        }
        rows.sort((a, b) => {
          const latA = typeof a.data.lat === 'number' ? a.data.lat : 0;
          const latB = typeof b.data.lat === 'number' ? b.data.lat : 0;
          if (latA !== latB) return latA - latB;
          return a.id.localeCompare(b.id);
        });
        if (state.after) {
          const [afterLat, afterId] = state.after;
          rows = rows.filter((item) => {
            const lat = typeof item.data.lat === 'number' ? item.data.lat : 0;
            return lat > afterLat || (lat === afterLat && item.id > afterId);
          });
        }
        if (state.limit != null) rows = rows.slice(0, state.limit);
        reads.hotLeads += rows.length;
        return {
          docs: rows.map((item) => ({
            id: item.id,
            exists: true,
            data: () => applySelect(item.data, state.fields),
          })),
        };
      },
    };
    return self;
  }

  const db = {
    collection(name: string) {
      if (name === 'users') {
        return {
          doc(id: string) {
            return {
              async get() {
                reads.users += 1;
                const data = input.users?.[id];
                return { exists: Boolean(data), data: () => data, id };
              },
            };
          },
        };
      }
      if (name === 'hotLeads') {
        return {
          ...hotQuery({ filters: [], fields: null, limit: null, after: null }),
          doc(id: string) {
            return {
              async get() {
                const found = (input.hotLeads ?? []).find((item) => item.id === id);
                reads.hotLeads += 1;
                return {
                  id,
                  exists: Boolean(found),
                  data: () => (found ? { ...found.data } : undefined),
                };
              },
            };
          },
        };
      }
      if (name === 'territories') {
        return {
          where(field: string, op: string, value: unknown) {
            return {
              limit() {
                return {
                  async get() {
                    const docs = (input.territories ?? []).filter((item) => item.data[field] === value || op !== '==');
                    reads.territories += docs.length || 1;
                    return {
                      docs: docs.map((item) => ({
                        id: item.id,
                        data: () => ({ ...item.data }),
                      })),
                    };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };

  return { db: db as unknown as Firestore, reads };
}

function profile(role: string, extra: Record<string, unknown> = {}) {
  return {
    role,
    isActive: true,
    approved: true,
    approvalStatus: 'approved',
    status: 'active',
    email: `${role}@company.com`,
    name: 'Jane Rep',
    ...extra,
  };
}

function routeFor(
  db: Firestore,
  options: {
    now?: () => number;
    verify?: (token: string) => Promise<{ uid: string }>;
  } = {},
) {
  return createHotLeadsGet({
    verifyIdToken: async (token) => {
      if (options.verify) return options.verify(token);
      if (!token || token === 'bad') {
        const error = new Error('expired') as Error & { code: string };
        error.code = 'auth/id-token-expired';
        throw error;
      }
      const uid = token === 'tok-setter' ? 'uid-setter' : token === 'tok-manager' ? 'uid-manager' : token === 'tok-admin' ? 'uid-admin' : 'uid-1';
      return { uid };
    },
    getUser: async (uid) => {
      const doc = await db.collection('users').doc(uid).get();
      return { exists: doc.exists, data: doc.data() };
    },
    store: liveStore(db),
    territories: async (uid) => {
      const snap = await db.collection('territories').where('userId', '==', uid).limit(200).get();
      return {
        docs: snap.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => ({
          id: doc.id,
          data: doc.data(),
        })),
        truncated: false,
      };
    },
    now: options.now,
  });
}

async function getPoints(
  role: 'closer' | 'manager' | 'admin' | 'setter',
  search = 'mode=points',
  extra?: { now?: () => number; hotLeads?: FakeDoc[]; users?: Record<string, Record<string, unknown>> },
) {
  const tokens = { closer: 'tok', manager: 'tok-manager', admin: 'tok-admin', setter: 'tok-setter' };
  const users = extra?.users ?? {
    'uid-1': profile('closer'),
    'uid-manager': profile('manager'),
    'uid-admin': profile('admin'),
    'uid-setter': profile('setter'),
  };
  const { db, reads } = fakeDb({
    users,
    hotLeads: extra?.hotLeads ?? [row('ghl_a', pin())],
  });
  const GET = routeFor(db, { now: extra?.now });
  const response = await GET(new NextRequest(`https://example.com/api/hot-leads?${search}`, {
    headers: { authorization: `Bearer ${tokens[role]}` },
  }));
  const body = await response.json() as Record<string, unknown>;
  return { response, body, reads };
}

describe('GET /api/hot-leads?mode=points', () => {
  it('uses a bounded select of 2001 and only the overview fields', () => {
    const spec = describePointsQuery();
    assert.equal(spec.limit, HOT_LEADS_POINTS_QUERY_LIMIT);
    assert.equal(HOT_LEADS_POINTS_QUERY_LIMIT, HOT_LEADS_POINTS_CAP + 1);
    assert.deepEqual([...spec.select], [...HOT_LEADS_POINTS_FIELDS]);
    assert.deepEqual([...spec.select], ['lat', 'lng', 'hotStatus', 'testData']);
    for (const field of spec.select) {
      assert.equal(PII_KEYS.includes(field), false);
    }
  });

  it('returns 401, 403 for setter, and 200 for closer, manager, and admin', async () => {
    const calls: { points?: PointsQueryCall[] } = {};
    const rows = [row('ghl_a', pin())];

    const missing = await serveHotLeads({
      authorization: null,
      params: new URLSearchParams('mode=points'),
      deps: {
        verifyIdToken: async () => ({ uid: 'x' }),
        getUser: async () => ({ exists: false }),
        store: store(rows, calls),
      },
    });
    assert.equal(missing.status, 401);
    assert.deepEqual(missing.body, { error: 'unauthenticated' });
    assert.equal(calls.points, undefined);

    const expired = await serveHotLeads({
      authorization: 'Bearer bad',
      params: new URLSearchParams('mode=points'),
      deps: {
        verifyIdToken: async () => {
          const error = new Error('expired') as Error & { code: string };
          error.code = 'auth/id-token-expired';
          throw error;
        },
        getUser: async () => ({ exists: false }),
        store: store(rows, calls),
      },
    });
    assert.equal(expired.status, 401);
    assert.equal(calls.points, undefined);

    const denied = await serveHotLeads({
      authorization: 'Bearer good',
      params: new URLSearchParams('mode=points'),
      loadApprovedUser: async () => {
        throw new HttpError(403, 'no');
      },
      deps: {
        verifyIdToken: async () => {
          throw new HttpError(403, 'no');
        },
        getUser: async () => ({ exists: true, data: {} }),
        store: store(rows, calls),
      },
    });
    assert.equal(denied.status, 403);
    assert.deepEqual(denied.body, { error: 'not_allowed' });

    const setter = await handleHotLeadsGet({
      user: user('setter'),
      params: new URLSearchParams('mode=points'),
      store: store(rows, calls),
    });
    assert.equal(setter.status, 403);
    assert.deepEqual(setter.body, { error: 'not_allowed' });
    assert.equal(calls.points, undefined);

    for (const role of ['closer', 'manager', 'admin'] as const) {
      calls.points = [];
      const result = await handleHotLeadsGet({
        user: user(role),
        params: new URLSearchParams('mode=points'),
        store: store(rows, calls),
        now: () => Date.parse('2026-11-10T21:00:00.000Z'),
      });
      assert.equal(result.status, 200, role);
      assert.equal(result.headers['Cache-Control'], 'private, max-age=900');
      assertPointsContract(result.body as Record<string, unknown>);
      assert.deepEqual((result.body as { points: Array<{ id: string }> }).points.map((item) => item.id), ['ghl_a']);
      assert.equal((result.body as { truncated: boolean }).truncated, false);
      assert.equal((result.body as { generatedAt: string }).generatedAt, '2026-11-10T21:00:00.000Z');
      assert.deepEqual(calls.points?.[0], describePointsQuery());
      clearHotLeadsPointsMemo();
    }
  });

  it('keeps the response shape free of PII even when the store rows include contacts', async () => {
    const result = await handleHotLeadsGet({
      user: user('closer'),
      params: new URLSearchParams('mode=points&south=1&north=2&west=3&east=4&zoom=10'),
      store: store([
        row('ghl_a', pin()),
        row('ghl_b', pin({ testData: true, lat: 43.2, lng: -77.5 })),
        row('ghl_c', pin({ lat: null, lng: -77.6 })),
        row('ghl_d', pin({ lat: 43.3, lng: Number.NaN })),
        row('ghl_e', pin({ lat: Infinity, lng: -77.6 })),
        row('ghl_f', pin({ lat: 91, lng: -77.6 })),
        row('ghl_g', pin({ hotStatus: 'worked', lat: 43.4, lng: -77.5 })),
      ]),
      now: () => Date.parse('2026-11-10T21:00:00.000Z'),
    });
    assert.equal(result.status, 200);
    assertPointsContract(result.body as Record<string, unknown>);
    assert.deepEqual(
      (result.body as { points: Array<{ id: string; hotStatus: string | null }> }).points,
      [
        { id: 'ghl_a', lat: 43.1, lng: -77.6, hotStatus: 'active' },
        { id: 'ghl_g', lat: 43.4, lng: -77.5, hotStatus: 'worked' },
      ],
    );
  });

  it('caps at 2000 and sets truncated when the query overflows', async () => {
    const under = Array.from({ length: 2000 }, (_, index) => row(`ghl_${String(index).padStart(4, '0')}`, pin({
      lat: 43 + index / 100000,
    })));
    const underResult = await handleHotLeadsGet({
      user: user('admin'),
      params: new URLSearchParams('mode=points'),
      store: store(under),
    });
    assert.equal(underResult.status, 200);
    const underBody = underResult.body as { points: unknown[]; truncated: boolean };
    assert.equal(underBody.points.length, 2000);
    assert.equal(underBody.truncated, false);
    clearHotLeadsPointsMemo();

    const over = under.concat([row('ghl_2000', pin({ lat: 44 }))]);
    assert.equal(over.length, 2001);
    const overResult = await handleHotLeadsGet({
      user: user('admin'),
      params: new URLSearchParams('mode=points'),
      store: store(over),
    });
    assert.equal(overResult.status, 200);
    const overBody = overResult.body as { points: Array<{ id: string }>; truncated: boolean };
    assert.equal(overBody.points.length, 2000);
    assert.equal(overBody.truncated, true);
    assert.equal(overBody.points[0].id, 'ghl_0000');
    assert.equal(overBody.points.at(-1)?.id, 'ghl_1999');
    assertPointsContract(overBody as unknown as Record<string, unknown>);
  });

  it('does not read territories and leaves mode=map and ?id= unchanged', async () => {
    const calls: { lat?: LatQueryCall[]; points?: PointsQueryCall[]; ids?: string[] } = {};
    const territories: string[] = [];
    const rows = [
      row('ghl_a', pin()),
      row('ghl_secret', pin({ testData: true })),
    ];
    const points = await handleHotLeadsGet({
      user: user('closer'),
      params: new URLSearchParams('mode=points'),
      store: store(rows, calls),
      territories: async (uid) => {
        territories.push(uid);
        return { docs: [], truncated: false };
      },
    });
    assert.equal(points.status, 200);
    assert.deepEqual((points.body as { points: Array<{ id: string }> }).points.map((item) => item.id), ['ghl_a']);
    assert.equal(territories.length, 0);
    assert.equal(calls.lat == null, true);
    assert.equal(calls.ids == null, true);
    assert.equal(points.headers['Cache-Control'], 'private, max-age=900');

    const map = await handleHotLeadsGet({
      user: user('closer'),
      params: new URLSearchParams(MAP),
      store: store(rows, calls),
      territories: async (uid) => {
        territories.push(uid);
        return { docs: [], truncated: false };
      },
    });
    assert.equal(map.status, 200);
    assert.equal(map.headers['Cache-Control'], 'private, no-store');
    const mapBody = map.body as { hotLeads: Array<Record<string, unknown>> };
    assert.deepEqual(mapBody.hotLeads.map((item) => item.id), ['ghl_a']);
    assert.equal((mapBody.hotLeads[0].contacts as Array<{ phone: string }>)[0].phone, SECRET_PHONE);
    assert.equal(mapBody.hotLeads[0].address, SECRET_STREET);
    assert.equal(calls.lat?.length, 1);
    assert.equal(territories.length, 1);

    const detail = await handleHotLeadsGet({
      user: user('closer'),
      params: new URLSearchParams('id=ghl_secret'),
      store: store(rows, calls),
    });
    assert.equal(detail.status, 404);
    assert.equal(detail.headers['Cache-Control'], 'private, no-store');
    assert.equal(calls.ids?.includes('ghl_secret'), true);

    const unknownMode = await handleHotLeadsGet({
      user: user('closer'),
      params: new URLSearchParams('mode=cluster'),
      store: store(rows, calls),
    });
    assert.equal(unknownMode.status, 400);
    assert.deepEqual(unknownMode.body, { error: 'invalid_bounds' });
  });

  it('reuses the per-instance memo for 15 minutes without sharing unauthenticated results', async () => {
    const calls: { points?: PointsQueryCall[] } = {};
    const rows = [row('ghl_a', pin())];
    let now = Date.parse('2026-11-10T21:00:00.000Z');
    const first = await handleHotLeadsGet({
      user: user('closer'),
      params: new URLSearchParams('mode=points'),
      store: store(rows, calls),
      now: () => now,
    });
    assert.equal(calls.points?.length, 1);
    const second = await handleHotLeadsGet({
      user: user('manager'),
      params: new URLSearchParams('mode=points'),
      store: store(rows, calls),
      now: () => now + 60 * 1000,
    });
    assert.equal(calls.points?.length, 1);
    assert.equal(second.body.generatedAt, first.body.generatedAt);
    assert.deepEqual(second.body.points, first.body.points);

    const denied = await handleHotLeadsGet({
      user: user('setter'),
      params: new URLSearchParams('mode=points'),
      store: store(rows, calls),
      now: () => now + 60 * 1000,
    });
    assert.equal(denied.status, 403);
    assert.equal(calls.points?.length, 1);

    now = Date.parse('2026-11-10T21:00:00.000Z') + HOT_LEADS_POINTS_CACHE_MS;
    const stale = await handleHotLeadsGet({
      user: user('admin'),
      params: new URLSearchParams('mode=points'),
      store: store(rows, calls),
      now: () => now,
    });
    assert.equal(calls.points?.length, 2);
    assert.equal(stale.status, 200);
  });
});

describe('GET /api/hot-leads route handler with a fake Admin SDK', () => {
  it('enforces the auth matrix and cache header on the real route factory', async () => {
    const { db, reads } = fakeDb({
      users: {
        'uid-1': profile('closer'),
        'uid-setter': profile('setter'),
        'uid-manager': profile('manager'),
        'uid-admin': profile('admin'),
      },
      hotLeads: [row('ghl_a', pin())],
    });
    const GET = routeFor(db);
    const missing = await GET(new NextRequest('https://example.com/api/hot-leads?mode=points'));
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), { error: 'unauthenticated' });
    assert.equal(reads.hotLeads, 0);
    assert.equal(reads.users, 0);

    const bad = await GET(new NextRequest('https://example.com/api/hot-leads?mode=points', {
      headers: { authorization: 'Bearer bad' },
    }));
    assert.equal(bad.status, 401);
    assert.equal(reads.hotLeads, 0);

    const setter = await GET(new NextRequest('https://example.com/api/hot-leads?mode=points', {
      headers: { authorization: 'Bearer tok-setter' },
    }));
    assert.equal(setter.status, 403);
    assert.deepEqual(await setter.json(), { error: 'not_allowed' });
    assert.equal(reads.hotLeads, 0);
    assert.equal(reads.territories, 0);

    for (const role of ['closer', 'manager', 'admin'] as const) {
      clearHotLeadsPointsMemo();
      const allowed = await getPoints(role);
      assert.equal(allowed.response.status, 200, role);
      assert.equal(allowed.response.headers.get('cache-control'), 'private, max-age=900');
      assertPointsContract(allowed.body);
      assert.equal(allowed.reads.territories, 0);
      assert.equal(allowed.reads.users, 1);
      assert.equal(allowed.reads.hotLeads, 1);
      assert.deepEqual(allowed.reads.select[0], ['lat', 'lng', 'hotStatus', 'testData']);
      assert.deepEqual(allowed.reads.limits, [2001]);
    }
  });

  it('counts one user read plus one read per returned hotLeads doc, and memo skips the collection', async () => {
    const leads = [
      row('ghl_a', pin({ lat: 43.02, lng: -77.64 })),
      row('ghl_b', pin({ lat: 43.03, lng: -77.63, hotStatus: 'converted' })),
      row('ghl_test', pin({ testData: true, lat: 43.04, lng: -77.62 })),
    ];
    const { db, reads } = fakeDb({
      users: { 'uid-1': profile('closer') },
      hotLeads: leads,
    });
    const now = Date.parse('2026-11-10T21:00:00.000Z');
    const GET = routeFor(db, { now: () => now });
    const first = await GET(new NextRequest('https://example.com/api/hot-leads?mode=points', {
      headers: { authorization: 'Bearer tok' },
    }));
    const firstBody = await first.json() as Record<string, unknown>;
    assert.equal(first.status, 200);
    assertPointsContract(firstBody);
    assert.deepEqual((firstBody.points as Array<{ id: string }>).map((item) => item.id), ['ghl_a', 'ghl_b']);
    assert.equal(reads.users, 1);
    assert.equal(reads.hotLeads, 3);
    assert.equal(reads.territories, 0);

    const second = await GET(new NextRequest('https://example.com/api/hot-leads?mode=points', {
      headers: { authorization: 'Bearer tok' },
    }));
    const secondBody = await second.json() as Record<string, unknown>;
    assert.equal(second.status, 200);
    assert.equal(secondBody.generatedAt, firstBody.generatedAt);
    assert.equal(reads.users, 2);
    assert.equal(reads.hotLeads, 3);
    assert.equal(reads.territories, 0);

    const map = await GET(new NextRequest(`https://example.com/api/hot-leads?${MAP}`, {
      headers: { authorization: 'Bearer tok' },
    }));
    const mapBody = await map.json() as { hotLeads: Array<Record<string, unknown>> };
    assert.equal(map.status, 200);
    assert.equal(map.headers.get('cache-control'), 'private, no-store');
    assert.equal((mapBody.hotLeads[0].contacts as Array<{ phone: string }>)[0].phone, SECRET_PHONE);
  });

  it('drops testData and invalid coordinates in liveStore select results', async () => {
    const { db, reads } = fakeDb({
      users: { 'uid-1': profile('closer') },
      hotLeads: [
        row('ghl_a', pin()),
        row('ghl_b', pin({ lat: null, lng: -77.6, address: SECRET_STREET })),
        row('ghl_c', pin({ testData: true })),
      ],
    });
    const GET = routeFor(db);
    const response = await GET(new NextRequest('https://example.com/api/hot-leads?mode=points', {
      headers: { authorization: 'Bearer tok' },
    }));
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 200);
    assertPointsContract(body);
    assert.deepEqual((body.points as Array<{ id: string }>).map((item) => item.id), ['ghl_a']);
    assert.equal(reads.select[0].includes('address'), false);
    assert.equal(reads.select[0].includes('contacts'), false);
  });
});

describe('toHotLeadPoint', () => {
  it('never copies PII fields onto a point', () => {
    const point = toHotLeadPoint('ghl_a', pin());
    assert.deepEqual(point, { id: 'ghl_a', lat: 43.1, lng: -77.6, hotStatus: 'active' });
    assert.equal(toHotLeadPoint('ghl_b', pin({ testData: true })), null);
  });
});
