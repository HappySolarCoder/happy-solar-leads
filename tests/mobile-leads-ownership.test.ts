import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Timestamp } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { createMobileLeadHandler } from '../app/utils/server/mobileLeads';
import {
  TERRITORY_CACHE_MS,
  invalidateMobileTerritoryCache,
  loadOwnershipContext,
  resetMobileOwnershipCaches,
} from '../app/utils/server/mobileOwnership';

const NOW = Date.now();
const DAY = 86_400_000;
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

function setup(opts: { role?: string; flag?: boolean; territories?: Array<[string, Doc]>; leads?: Array<[string, Doc]>; events?: Array<[string, Doc]> }) {
  resetMobileOwnershipCaches();
  const docs = new Map<string, Doc>();
  const log: string[] = [];
  docs.set('users/me', { name: 'Me Rep', role: opts.role ?? 'setter', isActive: true });
  docs.set('users/sawyer', { name: 'Sawyer V', isActive: true });
  docs.set('users/jordan', { name: 'Jordan M', isActive: true });
  docs.set('users/gone', { name: 'Gone Rep', isActive: false });
  if (opts.flag) docs.set('adminSettings/fieldOwnership', { mode: 'territory' });
  for (const [id, d] of opts.territories ?? []) docs.set(`territories/${id}`, d);
  for (const [id, d] of opts.leads ?? []) docs.set(`leads/${id}`, d);
  for (const [id, d] of opts.events ?? []) docs.set(`fieldKnockEvents/${id}`, d);
  const GET = createMobileLeadHandler({
    adminAuth: () => ({ verifyIdToken: async () => ({ uid: 'me' }) }) as never,
    adminDb: () => fakeDb(docs, log) as never,
  });
  const call = async (query: string) => {
    const res = await GET(new NextRequest(`http://localhost/api/mobile-leads?${query}`, { headers: { authorization: 'Bearer t' } }));
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  return { call, log, docs };
}
const MAP = 'mode=map&south=33.44&north=33.46&west=-112.08&east=-112.06&zoom=16';
const T = (userId: string, extra: Doc = {}): Doc => ({ userId, polygon: box(33.45, -112.07), createdAt: '2026-08-03T00:00:00.000Z', ...extra });
const pin = (extra: Doc = {}): Doc => ({ lat: 33.45, lng: -112.07, status: 'not-home', claimedBy: 'jordan', ...extra });

describe('/api/mobile-leads ownership fields', () => {
  beforeEach(() => resetMobileOwnershipCaches());

  it('flag OFF (no doc): rows are unchanged, ownership is legacy, no extra reads', async () => {
    const t = setup({ territories: [['mine', T('me')]], leads: [['l1', pin()]] });
    const { body } = await t.call(MAP);
    assert.equal(body.ownership, 'legacy');
    assert.equal(body.leads.length, 1);
    for (const key of ['ownedByMe', 'owners', 'ownerSource', 'expiredGoBack', 'inOtherUsersTerritory']) assert.equal(key in body.leads[0], false, key);
    assert.equal(t.log.some((l) => l.startsWith('getAll')), false);
  });

  it('flag ON: ownedByMe, owners [{uid,name}], expiredGoBack, inOtherUsersTerritory per row', async () => {
    const t = setup({
      flag: true,
      territories: [['mine', T('me')], ['theirs', T('sawyer', { assignedAt: '2026-11-09T00:00:00.000Z' })]],
      leads: [
        ['dual', pin({ claimedBy: 'jordan' })],
        ['expired', pin({ lat: 33.4501, status: 'go-back', goBackScheduledBy: 'jordan', dispositionedAt: ts(NOW - 120 * DAY) })],
        ['goback', pin({ lat: 33.4502, status: 'go-back', goBackScheduledBy: 'jordan', dispositionedAt: ts(NOW - 10 * DAY) })],
        ['departed', pin({ lat: 33.4503, status: 'go-back', goBackScheduledBy: 'gone', dispositionedAt: ts(NOW - 10 * DAY) })],
      ],
    });
    const { body } = await t.call(MAP);
    assert.equal(body.ownership, 'territory');
    assert.equal(body.popupExempt, false);
    const by = Object.fromEntries(body.leads.map((l: any) => [l.id, l]));
    // I and Sawyer both have a territory over this pin: dual owners, newest assignment first.
    assert.equal(by.dual.ownedByMe, true);
    assert.deepEqual(by.dual.owners, [{ uid: 'sawyer', name: 'Sawyer V' }, { uid: 'me', name: 'Me Rep' }]);
    assert.equal(by.dual.ownerSource, 'territory');
    assert.equal(by.dual.inOtherUsersTerritory, false);
    assert.equal(by.dual.expiredGoBack, false);
    // Go Back older than 90 d: flagged, owned by the territory owners (not the setter).
    assert.equal(by.expired.expiredGoBack, true);
    assert.equal(by.expired.ownedByMe, true);
    assert.deepEqual(by.expired.owners.map((o: any) => o.uid), ['sawyer', 'me']);
    assert.equal(by.expired.status, 'go-back', 'the stored status is never rewritten');
    // Inside 90 d the setter owns it, I do not, and it sits in my territory.
    assert.equal(by.goback.expiredGoBack, false);
    assert.equal(by.goback.ownedByMe, false);
    assert.deepEqual(by.goback.owners, [{ uid: 'jordan', name: 'Jordan M' }]);
    assert.equal(by.goback.ownerSource, 'go-back');
    // A setter who left reverts to the territory owners.
    assert.equal(by.departed.ownerSource, 'territory');
    assert.equal(by.departed.ownedByMe, true);
  });

  it('inOtherUsersTerritory: true when the pin is in someone else\'s territory only; false in no territory', async () => {
    const t = setup({
      flag: true,
      territories: [['mine', T('me', { polygon: box(33.45, -112.07, 0.004) })], ['theirs', T('sawyer', { polygon: box(33.45, -112.0705, 0.0004) })]],
      leads: [['both', pin({ lat: 33.45, lng: -112.0705 })], ['mineOnly', pin({ lat: 33.4535, lng: -112.07 })]],
    });
    const rows = Object.fromEntries((await t.call(MAP)).body.leads.map((l: any) => [l.id, l]));
    assert.equal(rows.both.inOtherUsersTerritory, false, 'dual owner: no popup');
    assert.equal(rows.mineOnly.inOtherUsersTerritory, false);
    const staff = setup({
      role: 'admin',
      flag: true,
      territories: [['theirs', T('sawyer')]],
      leads: [['x', pin()]],
    });
    const out = await staff.call(MAP);
    assert.equal(out.body.leads[0].inOtherUsersTerritory, true);
    assert.equal(out.body.popupExempt, true, 'staff exempt (final per Evan)');
  });

  it('personal mode returns popupExempt and own knockEvents {leadId, at, dispositionId} for 45 days, bounded', async () => {
    const t = setup({
      flag: true,
      events: [
        ['me_d1', { uid: 'me', leadId: 'l1', actionAt: ts(NOW - 2 * DAY), dispositionId: 'not-home', disposition: 'Not Home' }],
        ['me_d2', { uid: 'me', leadId: 'l2', actionAt: ts(NOW - 50 * DAY), dispositionId: 'not-home' }],
        ['me_d3', { uid: 'me', leadId: 'l3', actionAt: ts(NOW - DAY), dispositionId: 'shade-dq' }],
        ['sawyer_d1', { uid: 'sawyer', leadId: 'l9', actionAt: ts(NOW - DAY), dispositionId: 'not-home' }],
        ['mea_d1', { uid: 'mea', leadId: 'l8', actionAt: ts(NOW - DAY), dispositionId: 'not-home' }],
      ],
    });
    const { body } = await t.call('mode=personal&field=claimedBy');
    assert.deepEqual(body.knockEvents, [{ leadId: 'l1', at: NOW - 2 * DAY, dispositionId: 'not-home' }]);
    assert.equal(body.popupExempt, false);
    assert.equal('knockEventsTruncated' in body, false, 'no truncated key under the cap');
    assert.equal(body.ownership, 'territory');
    const events = t.log.filter((l) => l === 'query fieldKnockEvents');
    assert.equal(events.length, 1);
    // Later pages do not re-read events.
    const page2 = await t.call('mode=personal&field=claimedBy&after=abc');
    assert.equal('knockEvents' in page2.body, false);
  });
});

describe('own knockEvents read: newest first, capped, truncated', () => {
  const many = (n: number): Array<[string, Doc]> =>
    Array.from({ length: n }, (_, i) => [`me_d${String(i).padStart(4, '0')}`, { uid: 'me', leadId: `l${i}`, actionAt: ts(NOW - (n - i) * 60_000), dispositionId: 'not-home' }]);

  it('more rows than the cap: keeps the NEWEST, returns them newest-first, and says truncated', async () => {
    const t = setup({ flag: true, events: [...many(700), ['sawyer_x', { uid: 'sawyer', leadId: 'lx', actionAt: ts(NOW - 1000), dispositionId: 'not-home' }]] });
    const { body } = await t.call('mode=personal&field=claimedBy');
    assert.equal(body.knockEventsTruncated, true);
    assert.equal(body.knockEvents.length, 500, 'return limit');
    assert.equal(body.knockEvents[0].leadId, 'l699', 'the newest event is kept');
    assert.ok(body.knockEvents.every((e: { at: number }, i: number, all: Array<{ at: number }>) => i === 0 || all[i - 1].at >= e.at));
    assert.ok(!body.knockEvents.some((e: { leadId: string }) => e.leadId === 'lx'), 'only the caller own events');
    assert.ok(!body.knockEvents.some((e: { leadId: string }) => e.leadId === 'l0'), 'the oldest fall off, not the newest');
  });

  it('the 45-day window is part of the query, so old rows never use up the cap', async () => {
    const old: Array<[string, Doc]> = Array.from({ length: 650 }, (_, i) => [`me_old${i}`, { uid: 'me', leadId: `o${i}`, actionAt: ts(NOW - 60 * DAY - i * 1000), dispositionId: 'not-home' }]);
    const t = setup({ flag: true, events: [...old, ['me_new', { uid: 'me', leadId: 'fresh', actionAt: ts(NOW - DAY), dispositionId: 'not-home' }]] });
    const { body } = await t.call('mode=personal&field=claimedBy');
    assert.deepEqual(body.knockEvents.map((e: { leadId: string }) => e.leadId), ['fresh']);
    assert.equal('knockEventsTruncated' in body, false);
  });

  it('a failed events read (e.g. index not deployed yet) still returns the leads, with no events', async () => {
    const t = setup({ flag: true, events: many(3) });
    // Make only the fieldKnockEvents query throw.
    const proto = Object.getPrototypeOf(new Q(new Map(), 'x', []));
    const get = proto.get;
    proto.get = async function (this: { name: string }) {
      if (this.name === 'fieldKnockEvents') throw new Error('9 FAILED_PRECONDITION: The query requires an index');
      return get.call(this);
    };
    try {
      const out = await t.call('mode=personal&field=claimedBy');
      assert.equal(out.status, 200);
      assert.deepEqual(out.body.knockEvents, []);
      assert.ok(Array.isArray(out.body.leads));
    } finally {
      proto.get = get;
    }
  });

  it('firestore.indexes.json carries the (uid ASC, actionAt DESC) index for fieldKnockEvents', () => {
    const indexes = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8')).indexes as Array<{ collectionGroup: string; queryScope: string; fields: Array<{ fieldPath: string; order: string }> }>;
    const hit = indexes.filter((index) => index.collectionGroup === 'fieldKnockEvents');
    assert.equal(hit.length, 1);
    assert.equal(hit[0].queryScope, 'COLLECTION');
    assert.deepEqual(hit[0].fields, [{ fieldPath: 'uid', order: 'ASCENDING' }, { fieldPath: 'actionAt', order: 'DESCENDING' }]);
  });
});

describe('territory polygon cache (5 min) and flag cache (60 s)', () => {
  const terr: Array<[string, Doc]> = [['t1', { userId: 'me', polygon: box(33.45, -112.07), createdAt: ts(NOW) }]];
  const territoryReads = (log: string[]) => log.filter((line) => line === 'query territories').length;
  const T = 1_000_000_000_000;

  it('polygons are read once per 5 minutes per instance, not once a minute', async () => {
    const { log, docs } = setup({ flag: true, territories: terr });
    const db = fakeDb(docs, log) as never;
    assert.equal((await loadOwnershipContext(db, T)).mode, 'territory');
    for (const minutes of [1, 2, 3, 4]) await loadOwnershipContext(db, T + minutes * 60_000);
    assert.equal(territoryReads(log), 1);
    assert.equal(TERRITORY_CACHE_MS, 5 * 60_000);
    await loadOwnershipContext(db, T + TERRITORY_CACHE_MS + 1);
    assert.equal(territoryReads(log), 2);
  });

  it('a flag flip still shows up within 60 s while the polygons stay cached', async () => {
    const { log, docs } = setup({ flag: false, territories: terr });
    const db = fakeDb(docs, log) as never;
    assert.equal((await loadOwnershipContext(db, T)).mode, 'legacy');
    docs.set('adminSettings/fieldOwnership', { mode: 'territory' });
    assert.equal((await loadOwnershipContext(db, T + 30_000)).mode, 'legacy');
    assert.equal((await loadOwnershipContext(db, T + 61_000)).mode, 'territory');
    await loadOwnershipContext(db, T + 130_000);
    assert.equal(territoryReads(log), 1, 'second look at a flag that stayed on does not re-read polygons');
  });

  it('a territory write on this instance invalidates the cache immediately', async () => {
    const { log, docs } = setup({ flag: true, territories: terr });
    const db = fakeDb(docs, log) as never;
    const first = await loadOwnershipContext(db, T);
    docs.set('territories/t1', { userId: 'sawyer', polygon: box(33.45, -112.07), createdAt: ts(NOW) });
    assert.equal((await loadOwnershipContext(db, T + 61_000)).territories?.[0].userIds[0], first.territories?.[0].userIds[0], 'stale until invalidated');
    invalidateMobileTerritoryCache();
    assert.equal((await loadOwnershipContext(db, T + 62_000)).territories?.[0].userIds[0], 'sawyer');
    assert.equal(territoryReads(log), 2);
  });

  it('a failed re-read keeps serving the last good polygons instead of dropping to legacy', async () => {
    const { log, docs } = setup({ flag: true, territories: terr });
    const real = fakeDb(docs, log);
    const db = real as never;
    await loadOwnershipContext(db, T);
    const failing = { ...real, collection: (name: string) => (name === 'territories' ? { select: () => ({ limit: () => ({ get: async () => { throw new Error('unavailable'); } }) }) } : real.collection(name)) } as never;
    const ctx = await loadOwnershipContext(failing, T + TERRITORY_CACHE_MS + 5);
    assert.equal(ctx.mode, 'territory');
    assert.equal(ctx.territories?.length, 1);
  });
});
