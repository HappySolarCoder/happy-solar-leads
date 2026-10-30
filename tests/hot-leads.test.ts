import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HttpError } from '../app/utils/server/requireApprovedUser';
import { HOT_LEADS_PAGE } from '../app/utils/server/hotLeadContract';
import {
  applyLatBand,
  describeLatBand,
  handleHotLeadsGet,
  mapBoundsProblem,
  serveHotLeads,
  type HotLeadRow,
  type HotLeadStore,
  type LatQueryCall,
} from '../app/utils/server/hotLeads';

const SECRET_NAME = 'Test Person';
const SECRET_PHONE = '5550101';
const SECRET_EMAIL = 'test.person@example.com';
const SECRET_STREET = '10 Main Street';

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
    hotStatus: 'active',
    linkedLeadId: 'lead-77',
    homeownerId: null,
    ...partial,
  };
}

function store(rows: HotLeadRow[], specs: LatQueryCall[]): HotLeadStore {
  return {
    async latBand(spec) {
      specs.push(spec);
      return rows;
    },
    async getById(id) {
      return rows.find((item) => item.id === id) ?? null;
    },
  };
}

function capture() {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((part) => String(part)).join(' '));
  };
  return {
    lines,
    restore() {
      console.log = original;
    },
  };
}

describe('GET /api/hot-leads', () => {
  it('uses a lat range of 200 and no equality filter', () => {
    const spec = describeLatBand({ south: 43, north: 43.02, after: { id: 'ghl_a', lat: 43.01 } });
    assert.equal(spec.limit, HOT_LEADS_PAGE);
    assert.equal(HOT_LEADS_PAGE, 200);
    assert.deepEqual(spec.where.map((filter) => filter.op), ['>=', '<=']);
    assert.deepEqual(spec.where.map((filter) => filter.field), ['lat', 'lat']);
    const calls: string[] = [];
    const query = {
      where(field: string, op: string) {
        calls.push(`${field}:${op}`);
        return this;
      },
      orderBy(field: unknown) {
        calls.push(`order:${String(field)}`);
        return this;
      },
      limit(n: number) {
        calls.push(`limit:${n}`);
        return this;
      },
      startAfter(lat: number, id: string) {
        calls.push(`start:${lat}:${id}`);
        return this;
      },
    };
    applyLatBand(query, spec, '__name__');
    assert.deepEqual(calls, ['lat:>=', 'lat:<=', 'order:lat', 'order:__name__', 'limit:200', 'start:43.01:ghl_a']);
    assert.equal(calls.some((call) => call.includes('==')), false);
    const route = readFileSync(new URL('../app/api/hot-leads/route.ts', import.meta.url), 'utf8');
    assert.match(route, /requireApprovedRequestUser/);
    assert.match(route, /applyLatBand/);
  });

  it('rejects bad map bounds', () => {
    assert.equal(mapBoundsProblem(new URLSearchParams('mode=map&south=1&north=1&west=0&east=0.01&zoom=16')), true);
    assert.equal(mapBoundsProblem(new URLSearchParams('mode=map&south=43&north=43.02&west=-77.6&east=-77.55&zoom=14')), true);
    assert.equal(mapBoundsProblem(new URLSearchParams('mode=map&south=43&north=43.02&west=-77.6&east=-77.55&zoom=16')), false);
  });

  it('returns 401, 403, and 400 without reading hot leads', async () => {
    const specs: LatQueryCall[] = [];
    const logs = capture();
    try {
      const missing = await serveHotLeads({
        authorization: null,
        params: new URLSearchParams('mode=map'),
        deps: {
          verifyIdToken: async () => ({ uid: 'x' }),
          getUser: async () => ({ exists: false }),
          store: store([], specs),
        },
      });
      assert.equal(missing.status, 401);
      assert.deepEqual(missing.body, { error: 'unauthenticated' });
      const expired = await serveHotLeads({
        authorization: 'Bearer bad',
        params: new URLSearchParams('mode=map'),
        deps: {
          verifyIdToken: async () => {
            const error = new Error('expired') as Error & { code: string };
            error.code = 'auth/id-token-expired';
            throw error;
          },
          getUser: async () => ({ exists: false }),
          store: store([], specs),
        },
      });
      assert.equal(expired.status, 401);
      const mapped = await serveHotLeads({
        authorization: 'Bearer good',
        params: new URLSearchParams('mode=map'),
        loadApprovedUser: async () => { throw new HttpError(403, 'no'); },
        deps: {
          verifyIdToken: async () => { throw new HttpError(403, 'no'); },
          getUser: async () => ({ exists: true, data: {} }),
          store: store([], specs),
        },
      });
      assert.equal(mapped.status, 403);
      assert.deepEqual(mapped.body, { error: 'not_allowed' });
      for (const denied of [
        user('setter'),
        user('closer', { team: 'TEST' }),
        user('closer', { isTestAccount: true }),
        user('manager', { testData: true }),
        user('viewer'),
        user('closer', { isActive: false }),
      ]) {
        const result = await handleHotLeadsGet({
          user: denied,
          params: new URLSearchParams('mode=map&south=43&north=43.02&west=-77.6&east=-77.55&zoom=16'),
          store: store([row('ghl_a', pin())], specs),
        });
        assert.equal(result.status, 403, denied.role);
        assert.deepEqual(result.body, { error: 'not_allowed' });
      }
      const bounds = await handleHotLeadsGet({
        user: user('closer'),
        params: new URLSearchParams('mode=map&zoom=10'),
        store: store([], specs),
      });
      assert.equal(bounds.status, 400);
      assert.deepEqual(bounds.body, { error: 'invalid_bounds' });
      assert.equal(specs.length, 0);
      const blob = logs.lines.join('\n');
      assert.equal(blob.includes(SECRET_NAME), false);
      assert.equal(blob.includes(SECRET_PHONE), false);
      assert.equal(blob.includes(SECRET_EMAIL), false);
      assert.equal(blob.includes(SECRET_STREET), false);
      assert.match(logs.lines[0], /^\[hot-leads\] 401 /);
    } finally {
      logs.restore();
    }
  });

  it('returns pins for closer, manager, and admin, including phone and email', async () => {
    const specs: LatQueryCall[] = [];
    const rows = [
      row('ghl_a', pin()),
      row('ghl_b', pin({ lng: -70, testData: true, contacts: [{ phone: '5550199' }] })),
      row('ghl_c', pin({ lat: 43.02, lng: -77.58, linkedLeadId: 'lead-88', contacts: [{ name: 'Other', phone: '5550108', email: 'other@example.com' }] })),
    ];
    for (const role of ['closer', 'manager', 'admin']) {
      specs.length = 0;
      const result = await handleHotLeadsGet({
        user: user(role),
        params: new URLSearchParams('mode=map&south=43&north=43.05&west=-77.66&east=-77.58&zoom=16'),
        store: store(rows, specs),
      });
      assert.equal(result.status, 200, role);
      assert.equal(result.headers['Cache-Control'], 'private, no-store');
      const body = result.body as { hotLeads: Array<Record<string, unknown>>; nextCursor: unknown; capabilities: { dispo: boolean; claim: boolean } };
      assert.deepEqual(body.hotLeads.map((item) => item.id), ['ghl_a', 'ghl_c']);
      assert.equal(body.capabilities.dispo, true);
      assert.equal(body.capabilities.claim, true);
      assert.equal(body.nextCursor, null);
      assert.equal((body.hotLeads[0].contacts as Array<{ phone: string; email: string }>)[0].phone, SECRET_PHONE);
      assert.equal((body.hotLeads[0].contacts as Array<{ email: string }>)[0].email, SECRET_EMAIL);
      assert.equal(body.hotLeads[0].linkedLeadId, 'lead-77');
      assert.equal(body.hotLeads[0].doNotCall, false);
      assert.equal(specs[0].limit, 200);
      assert.deepEqual(specs[0].where.map((filter) => filter.op), ['>=', '<=']);
    }
  });

  it('pages with the lat cursor and hides testData on detail', async () => {
    const specs: LatQueryCall[] = [];
    const rows = Array.from({ length: 200 }, (_, index) => row(`ghl_${String(index).padStart(3, '0')}`, pin({
      lat: 43 + index / 100000,
      contacts: [{ name: 'N', phone: '5550100' }],
      address: 'x',
    })));
    const page = await handleHotLeadsGet({
      user: user('closer'),
      params: new URLSearchParams('mode=map&south=43&north=43.05&west=-77.66&east=-77.58&zoom=16&after=ghl_010&afterLat=43.01'),
      store: store(rows, specs),
    });
    assert.equal(page.status, 200);
    const body = page.body as { hotLeads: unknown[]; nextCursor: { id: string; lat: number } };
    assert.equal(body.hotLeads.length, 200);
    assert.equal(body.nextCursor.id, 'ghl_199');
    assert.equal(specs[0].startAfter?.[1], 'ghl_010');
    const history = Array.from({ length: 60 }, (_, index) => ({
      disposition: `d${index}`,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      userId: 'uid-1',
      userName: 'Jane Rep',
    }));
    const detail = await handleHotLeadsGet({
      user: user('admin'),
      params: new URLSearchParams('id=ghl_opp1'),
      store: store([row('ghl_opp1', pin({ dispositionHistory: history, ghl: { stage: 'New', source: 'web', createdOn: '2026-01-01T00:00:00.000Z' } }))], specs),
    });
    assert.equal(detail.status, 200);
    const hotLead = (detail.body as { hotLead: Record<string, unknown> }).hotLead;
    assert.equal((hotLead.dispositionHistory as unknown[]).length, 50);
    assert.equal(((hotLead.dispositionHistory as Array<{ disposition: string }>)[0]).disposition, 'd59');
    assert.equal(hotLead.ghlStage, 'New');
    assert.equal(hotLead.doNotCall, false);
    assert.equal(hotLead.phone, undefined);
    const warned = await handleHotLeadsGet({
      user: user('closer'),
      params: new URLSearchParams('mode=map&south=43&north=43.05&west=-77.66&east=-77.58&zoom=16'),
      store: store([row('ghl_dnc', pin({ doNotCall: true, contacts: [{ name: 'Skip Dnc', phone: '5550103' }] }))], specs),
    });
    assert.equal(warned.status, 200);
    const warnedPins = (warned.body as { hotLeads: Array<Record<string, unknown>> }).hotLeads;
    assert.equal(warnedPins[0].doNotCall, true);
    const warnedOne = await handleHotLeadsGet({
      user: user('manager'),
      params: new URLSearchParams('id=ghl_dnc'),
      store: store([row('ghl_dnc', pin({ doNotCall: true }))], specs),
    });
    assert.equal(warnedOne.status, 200);
    assert.equal((warnedOne.body as { hotLead: { doNotCall: boolean } }).hotLead.doNotCall, true);
    const hidden = await handleHotLeadsGet({
      user: user('closer'),
      params: new URLSearchParams('id=ghl_secret'),
      store: store([row('ghl_secret', pin({ testData: true }))], specs),
    });
    assert.equal(hidden.status, 404);
    assert.deepEqual(hidden.body, { error: 'not_found' });
    const badId = await handleHotLeadsGet({
      user: user('closer'),
      params: new URLSearchParams('id=lead-1'),
      store: store([], specs),
    });
    assert.equal(badId.status, 400);
  });
});
