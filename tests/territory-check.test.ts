import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Timestamp } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { createMobileLeadHandler } from '../app/utils/server/mobileLeads';
import { createTerritoryCheckHandler } from '../app/utils/server/territoryCheck';
import { TERRITORY_CACHE_MS, resetMobileOwnershipCaches, shortOwnerName } from '../app/utils/server/mobileOwnership';
import { FOREIGN_TERRITORY_WARNING } from '../app/utils/effectiveOwner';

const NOW = Date.now();
const box = (lat: number, lng: number, d = 0.004) => [
  { lat: lat - d, lng: lng - d }, { lat: lat - d, lng: lng + d }, { lat: lat + d, lng: lng + d }, { lat: lat + d, lng: lng - d },
];
const ts = (ms: number) => Timestamp.fromMillis(ms);

type Doc = Record<string, unknown>;
class Q {
  private filters: Array<[string, string, unknown]> = [];
  private lo: string | null = null;
  private hi: string | null = null;
  private cap = Infinity;
  constructor(private docs: Map<string, Doc>, private name: string, private log: string[]) {}
  where(f: string, op: string, v: unknown) { this.filters.push([f, op, v]); return this; }
  private order: { field: string; dir: 'asc' | 'desc' } | null = null;
  orderBy(field?: string, dir: 'asc' | 'desc' = 'asc') { if (typeof field === 'string') this.order = { field, dir }; return this; }
  select() { return this; }
  startAfter() { return this; }
  startAt(v: string) { this.lo = v; return this; }
  endAt(v: string) { this.hi = v; return this; }
  limit(n: number) { this.cap = n; return this; }
  async get() {
    this.log.push(`query ${this.name}`);
    const prefix = `${this.name}/`;
    let rows = [...this.docs.entries()].filter(([p]) => p.startsWith(prefix)).map(([p, d]) => ({ id: p.slice(prefix.length), data: d }));
    for (const [f, op, v] of this.filters) {
      rows = rows.filter((r) => {
        const num = (value: unknown) => (value && typeof (value as { toMillis?: unknown }).toMillis === 'function' ? (value as { toMillis(): number }).toMillis() : (value as number));
        const x = num(r.data[f]);
        return op === '==' ? r.data[f] === v : op === '>=' ? x >= num(v) : op === '<=' ? x <= num(v) : true;
      });
    }
    if (this.lo != null) rows = rows.filter((r) => r.id >= this.lo!);
    if (this.hi != null) rows = rows.filter((r) => r.id <= this.hi!);
    if (this.order) {
      const { field, dir } = this.order;
      const num = (value: unknown) => (value && typeof (value as { toMillis?: unknown }).toMillis === 'function' ? (value as { toMillis(): number }).toMillis() : (value as number));
      rows.sort((a, b) => (num(a.data[field]) - num(b.data[field])) * (dir === 'desc' ? -1 : 1));
    }
    rows = rows.slice(0, this.cap);
    return { size: rows.length, docs: rows.map((r) => ({ id: r.id, exists: true, data: () => r.data })) };
  }
}
function fakeDb(docs: Map<string, Doc>, log: string[]) {
  const ref = (name: string, id: string) => ({ __ref: `${name}/${id}`, get: async () => snap(`${name}/${id}`) });
  const snap = (path: string) => ({ exists: docs.has(path), id: path.split('/')[1], data: () => docs.get(path) });
  return {
    collection: (name: string) => Object.assign(new Q(docs, name, log), { doc: (id: string) => ref(name, id) }),
    getAll: async (...args: unknown[]) => {
      const refs = args.filter((a): a is { __ref: string } => Boolean(a) && typeof a === 'object' && '__ref' in (a as object));
      log.push(`getAll ${refs.length}`);
      return refs.map((r) => snap(r.__ref));
    },
  };
}


type Body = { owners: Array<{ uid: string; name: string | null }>; warn?: boolean; ownership?: string; [key: string]: unknown };
const IN = { lat: 33.45, lng: -112.07 };
const OUT = { lat: 34.5, lng: -111.0 };
const T = (userId: string, extra: Doc = {}): Doc => ({ userId, polygon: box(33.45, -112.07), createdAt: ts(NOW), ...extra });

function setup(opts: { role?: string; flag?: boolean; territories?: Array<[string, Doc]>; me?: Doc | null; uid?: string; verifyFails?: boolean; now?: () => number } = {}) {
  resetMobileOwnershipCaches();
  const docs = new Map<string, Doc>();
  const log: string[] = [];
  if (opts.me !== null) docs.set('users/me', { name: 'Me Rep', role: opts.role ?? 'setter', isActive: true, ...(opts.me ?? {}) });
  docs.set('users/sawyer', { name: 'Sawyer Vandenberg', isActive: true });
  docs.set('users/jordan', { name: 'Jordan M', isActive: true });
  docs.set('users/pat', { name: 'Patricia Anne-Marie  de la Cruz', isActive: true });
  docs.set('users/mono', { name: 'Cher', isActive: true });
  for (let i = 0; i < 7; i += 1) docs.set(`users/extra${i}`, { name: `Extra${i} Person`, isActive: true });
  if (opts.flag) docs.set('adminSettings/fieldOwnership', { mode: 'territory' });
  for (const [id, d] of opts.territories ?? []) docs.set(`territories/${id}`, d);
  const deps = {
    adminAuth: () => ({ verifyIdToken: async () => { if (opts.verifyFails) throw Object.assign(new Error('bad'), { code: 'auth/argument-error' }); return { uid: opts.uid ?? 'me' }; } }) as never,
    adminDb: () => fakeDb(docs, log) as never,
  };
  const POST = createTerritoryCheckHandler({ ...deps, now: opts.now });
  const GET = createMobileLeadHandler(deps);
  const check = async (body: unknown, headers: Record<string, string> = { authorization: 'Bearer t' }) => {
    const res = await POST(new NextRequest('http://localhost/api/field/territory-check', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));
    return { status: res.status, cache: res.headers.get('cache-control'), body: (await res.json()) as Body };
  };
  const mobile = async (query: string) => {
    const res = await GET(new NextRequest(`http://localhost/api/mobile-leads?${query}`, { headers: { authorization: 'Bearer t' } }));
    return { status: res.status, body: (await res.json()) as Body };
  };
  return { check, mobile, log, docs };
}
const territoryReads = (log: string[]) => log.filter((line) => line === 'query territories').length;
const writes = (docs: Map<string, Doc>) => JSON.stringify([...docs.entries()]);

describe('POST /api/field/territory-check', () => {
  beforeEach(() => resetMobileOwnershipCaches());

  it('401 without a bearer token or with a bad token; 403 for an inactive, deleted or missing user', async () => {
    const t = setup({ flag: true });
    assert.equal((await t.check(IN, {})).status, 401);
    assert.equal((await setup({ flag: true, verifyFails: true }).check(IN)).status, 401);
    for (const me of [{ isActive: false }, { deleted: true }, { deletionPending: true }, { approved: false }, { approvalStatus: 'pending' }]) {
      const out = await setup({ flag: true, me }).check(IN);
      assert.equal(out.status, 403, JSON.stringify(me));
      assert.deepEqual(out.body, { ok: false, error: 'forbidden' });
    }
    assert.equal((await setup({ flag: true, me: null }).check(IN)).status, 403);
    assert.equal(territoryReads(t.log), 0, 'no territory read before auth passes');
  });

  it('400 bad_coords for missing, non-numeric, non-finite and out-of-range points and unparsable bodies', async () => {
    const t = setup({ flag: true, territories: [['t1', T('sawyer')]] });
    for (const body of [{}, { lat: 33.4 }, { lat: '33.4', lng: '-112' }, { lat: null, lng: 1 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: -91, lng: 0 }, { lat: 0, lng: -181 }, { lat: 1e999, lng: 0 }, [], 'not json', '']) {
      const out = await t.check(body as never);
      assert.equal(out.status, 400, JSON.stringify(body));
      assert.deepEqual(out.body, { ok: false, error: 'bad_coords' });
    }
    assert.equal(territoryReads(t.log), 0);
  });

  it('flag OFF (no doc or legacy): legacy, warn false, no owners, and no territory read', async () => {
    for (const flagDoc of [undefined, { mode: 'legacy' }]) {
      const t = setup({ territories: [['t1', T('sawyer')]] });
      if (flagDoc) t.docs.set('adminSettings/fieldOwnership', flagDoc);
      const out = await t.check(IN);
      assert.equal(out.status, 200);
      assert.deepEqual(out.body, { ok: true, ownership: 'legacy', warn: false, popupExempt: false, inOtherUsersTerritory: false, owners: [] });
      assert.equal(territoryReads(t.log), 0, 'no territory read');
      assert.equal(t.log.filter((l) => l.startsWith('getAll')).length, 0, 'no directory read');
    }
    const staff = await setup({ role: 'manager', territories: [['t1', T('sawyer')]] }).check(IN);
    assert.deepEqual(staff.body, { ok: true, ownership: 'legacy', warn: false, popupExempt: true, inOtherUsersTerritory: false, owners: [] });
  });

  it("another user's territory warns, with the exact response shape and message", async () => {
    const t = setup({ flag: true, territories: [['t1', T('sawyer')]] });
    const out = await t.check(IN);
    assert.equal(out.status, 200);
    assert.equal(out.cache, 'private, no-store');
    assert.deepEqual(out.body, {
      ok: true,
      ownership: 'territory',
      warn: true,
      popupExempt: false,
      inOtherUsersTerritory: true,
      owners: [{ uid: 'sawyer', name: 'Sawyer V.' }],
      message: FOREIGN_TERRITORY_WARNING,
    });
    assert.deepEqual(Object.keys(out.body), ['ok', 'ownership', 'warn', 'popupExempt', 'inOtherUsersTerritory', 'owners', 'message']);
    assert.equal(out.body.message, "Warning: You are in another user's territory. Do you wish to place this pin?");
  });

  it('outside every territory: no warning, no owners, no message key', async () => {
    const t = setup({ flag: true, territories: [['t1', T('sawyer')]] });
    const out = await t.check(OUT);
    assert.deepEqual(out.body, { ok: true, ownership: 'territory', warn: false, popupExempt: false, inOtherUsersTerritory: false, owners: [] });
    assert.equal('message' in out.body, false);
  });

  it('my own territory: no warning, I am listed as owner', async () => {
    const t = setup({ flag: true, territories: [['t1', T('me')]] });
    const out = await t.check(IN);
    assert.equal(out.body.warn, false);
    assert.equal(out.body.inOtherUsersTerritory, false);
    assert.deepEqual(out.body.owners, [{ uid: 'me', name: 'Me R.' }]);
    assert.equal('message' in out.body, false);
  });

  it('dual owner (overlapping territories, one is mine): no warning and every owner is listed', async () => {
    const t = setup({ flag: true, territories: [['t1', T('sawyer', { createdAt: ts(NOW - 5000) })], ['t2', T('me', { createdAt: ts(NOW) })]] });
    const out = await t.check(IN);
    assert.equal(out.body.warn, false);
    assert.equal(out.body.inOtherUsersTerritory, false);
    assert.deepEqual(out.body.owners.map((o: { uid: string }) => o.uid).sort(), ['me', 'sawyer']);
    // A multi-assignee territory behaves the same.
    const multi = setup({ flag: true, territories: [['t1', T('sawyer', { userIds: ['sawyer', 'me'] })]] });
    assert.equal((await multi.check(IN)).body.warn, false);
  });

  it('two foreign territories overlapping: warns and lists both owners', async () => {
    const t = setup({ flag: true, territories: [['t1', T('sawyer')], ['t2', T('jordan')]] });
    const out = await t.check(IN);
    assert.equal(out.body.warn, true);
    assert.deepEqual(out.body.owners.map((o: { uid: string }) => o.uid).sort(), ['jordan', 'sawyer']);
  });

  it('staff (admin and manager) are exempt: warn false, inOtherUsersTerritory still true, no message', async () => {
    for (const role of ['admin', 'manager']) {
      const out = await setup({ role, flag: true, territories: [['t1', T('sawyer')]] }).check(IN);
      assert.deepEqual(out.body, {
        ok: true, ownership: 'territory', warn: false, popupExempt: true, inOtherUsersTerritory: true,
        owners: [{ uid: 'sawyer', name: 'Sawyer V.' }],
      }, role);
    }
    assert.equal((await setup({ role: 'closer', flag: true, territories: [['t1', T('sawyer')]] }).check(IN)).body.warn, true);
  });

  it('owner names are FIRST NAME + LAST INITIAL only, at most 5 owners', async () => {
    assert.equal(shortOwnerName('Jordan Miller'), 'Jordan M.');
    assert.equal(shortOwnerName('  jordan   miller  '), 'jordan M.');
    assert.equal(shortOwnerName('Patricia Anne-Marie de la Cruz'), 'Patricia C.');
    assert.equal(shortOwnerName('Cher'), 'Cher');
    assert.equal(shortOwnerName('Jordan M'), 'Jordan M.');
    assert.equal(shortOwnerName('   '), null);
    assert.equal(shortOwnerName(undefined), null);
    assert.equal(shortOwnerName(42), null);
    const t = setup({ flag: true, territories: [['t1', T('sawyer')], ['t2', T('pat')], ['t3', T('mono')], ['t4', T('ghost')]] });
    const out = await t.check(IN);
    const byUid = Object.fromEntries(out.body.owners.map((o: { uid: string; name: string | null }) => [o.uid, o.name]));
    assert.deepEqual(byUid, { sawyer: 'Sawyer V.', pat: 'Patricia C.', mono: 'Cher', ghost: null });
    for (const o of out.body.owners) assert.ok(o.name === null || /^\S+( [A-Z]\.)?$/.test(o.name), `no full names: ${o.name}`);
    assert.ok(!JSON.stringify(out.body).includes('Vandenberg'));
    assert.ok(!JSON.stringify(out.body).includes('Cruz'));
    const many = setup({ flag: true, territories: Array.from({ length: 7 }, (_, i) => [`t${i}`, T(`extra${i}`)] as [string, Doc]) });
    const capped = await many.check(IN);
    assert.equal(capped.body.owners.length, 5);
  });

  it('a failed directory read still answers (names null); a failed territory read fails open as legacy', async () => {
    const t = setup({ flag: true, territories: [['t1', T('sawyer')]] });
    const db = t.docs; // same docs, new handler whose getAll throws
    resetMobileOwnershipCaches();
    const log: string[] = [];
    const real = fakeDb(db, log);
    const POST = createTerritoryCheckHandler({
      adminAuth: () => ({ verifyIdToken: async () => ({ uid: 'me' }) }) as never,
      adminDb: () => ({ ...real, getAll: async () => { throw new Error('boom'); } }) as never,
    });
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(IN) }));
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.warn, true);
    assert.deepEqual(body.owners, [{ uid: 'sawyer', name: null }]);
    resetMobileOwnershipCaches();
    const broken = createTerritoryCheckHandler({
      adminAuth: () => ({ verifyIdToken: async () => ({ uid: 'me' }) }) as never,
      adminDb: () => ({ ...real, collection: (name: string) => (name === 'territories' ? { select: () => ({ limit: () => ({ get: async () => { throw new Error('down'); } }) }) } : real.collection(name)) }) as never,
    });
    const res2 = await broken(new NextRequest('http://localhost/x', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(IN) }));
    assert.equal(res2.status, 200);
    assert.deepEqual(await res2.json(), { ok: true, ownership: 'legacy', warn: false, popupExempt: false, inOtherUsersTerritory: false, owners: [] });
  });

  it('writes nothing: the data store is identical before and after, and the route source has no write calls', async () => {
    const t = setup({ flag: true, territories: [['t1', T('sawyer')]] });
    const before = writes(t.docs);
    await t.check(IN);
    await t.check(OUT);
    await t.check({ lat: 'x' } as never);
    assert.equal(writes(t.docs), before);
    for (const file of ['../app/utils/server/territoryCheck.ts', '../app/api/field/territory-check/route.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /\.(set|update|create|delete|add|batch|runTransaction)\(/, file);
    }
  });
});

describe('territory-check shares the mobile-leads territory cache (no per-call polygon reads)', () => {
  const T0 = 1_000_000_000_000;

  it('repeated calls within 5 minutes do 0 further territory reads; one fill, then a refill after 5 minutes', async () => {
    let clock = T0;
    const t = setup({ flag: true, territories: [['t1', T('sawyer')]], now: () => clock });
    await t.check(IN);
    assert.equal(territoryReads(t.log), 1, 'the cold call fills the cache once');
    for (const offset of [1, 59_000, 61_000, 120_000, 240_000, TERRITORY_CACHE_MS - 1]) {
      clock = T0 + offset;
      const out = await t.check(offset % 2 ? IN : OUT);
      assert.equal(out.status, 200);
    }
    assert.equal(territoryReads(t.log), 1, '0 territory reads for every repeat call inside 5 minutes');
    clock = T0 + TERRITORY_CACHE_MS + 1;
    await t.check(IN);
    assert.equal(territoryReads(t.log), 2, 'one refill after the TTL');
  });

  it('a mobile-leads call followed by a check call shares ONE cache fill (and the reverse order too)', async () => {
    const a = setup({ flag: true, territories: [['t1', T('sawyer')]] });
    assert.equal((await a.mobile('mode=personal&field=claimedBy')).body.ownership, 'territory');
    assert.equal(territoryReads(a.log), 1);
    const out = await a.check(IN);
    assert.equal(out.body.warn, true);
    assert.equal(territoryReads(a.log), 1, 'the check call reused the polygons mobile-leads loaded');
    const b = setup({ flag: true, territories: [['t1', T('sawyer')]] });
    await b.check(IN);
    assert.equal(territoryReads(b.log), 1);
    assert.equal((await b.mobile('mode=personal&field=claimedBy')).body.ownership, 'territory');
    assert.equal(territoryReads(b.log), 1, 'and mobile-leads reuses the polygons the check loaded');
  });

  it('the handler has no territory read of its own (it only goes through loadOwnershipContext)', () => {
    const source = readFileSync(new URL('../app/utils/server/territoryCheck.ts', import.meta.url), 'utf8');
    assert.match(source, /loadOwnershipContext\(db, now\)/);
    assert.doesNotMatch(source, /collection\('territories'\)/);
    assert.doesNotMatch(source, /loadTerritories|prepareTerritories/);
  });
});
