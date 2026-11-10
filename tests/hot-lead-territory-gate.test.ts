import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { FIELD_REASON_CODES } from '../app/utils/server/fieldReasonCodes';
import { HOT_LEAD_ROLE_SETS, withHotLeadRoles } from '../app/utils/server/hotLeadContract';
import {
  handleFieldDispo,
  type DispoDb,
  type DispoQuery,
  type DispoSnap,
  type DispoTransaction,
  type FieldDispoDeps,
} from '../app/utils/server/fieldDispo';
import { handleHotLeadClaim, handleHotLeadsGet, type ClaimDb, type ClaimSnap, type ClaimTx } from '../app/utils/server/hotLeads';
import { TERRITORY_QUERY_LIMIT } from '../app/utils/server/territoryGate';
import { insideTerritory } from '../app/utils/territoryManager';

const NOW = Date.parse('2026-10-25T16:31:04.120Z');
const ACTION = '2026-10-25T16:31:04.120Z';
const SERVER_TS = { marker: 'server-timestamp' };
const DELETED = { marker: 'delete' };

const SQUARE = [
  { lat: 10, lng: 10 },
  { lat: 10, lng: 12 },
  { lat: 12, lng: 12 },
  { lat: 12, lng: 10 },
];
const INSIDE = { lat: 11, lng: 11 };
const OUTSIDE = { lat: 20, lng: 20 };
const ON_EDGE = { lat: 10, lng: 11 };

class Stamp {
  constructor(readonly ms: number) {}
  toMillis() { return this.ms; }
  static fromMillis(ms: number) { return new Stamp(ms); }
}

function revive(value: unknown): unknown {
  if (value instanceof Stamp) return { __stamp: value.ms };
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = revive(item);
    return out;
  }
  return value;
}

class Mem implements DispoDb {
  docs = new Map<string, Record<string, unknown>>();
  events: string[] = [];
  patches: Array<{ path: string; patch: unknown }> = [];
  creates: Array<{ path: string; data: unknown }> = [];
  territoryQueries = 0;

  put(path: string, data: Record<string, unknown>) {
    this.docs.set(path, { ...data });
  }

  collection(name: string) {
    const query = (filters: Array<{ field: string; op: string; value: string }>, limitCount: number | null): DispoQuery => ({
      kind: 'query',
      collectionName: name,
      filters,
      limitCount,
      limit: (n: number) => query(filters, n),
    });
    return {
      name,
      doc: (id: string) => ({
        id,
        path: `${name}/${id}`,
        get: async () => this.snap(`${name}/${id}`),
      }),
      where: (field: string, op: string, value: string) => query([{ field, op, value }], null),
      cappedGet: (n: number) => query([], n),
    };
  }

  async runTransaction<T>(fn: (tx: DispoTransaction) => Promise<T>): Promise<T> {
    const queued: Array<() => void> = [];
    const tx: DispoTransaction = {
      get: async (ref) => {
        this.events.push(`get ${ref.path}`);
        return this.snap(ref.path);
      },
      getQuery: async (query) => {
        this.events.push(`query ${query.collectionName} ${query.limitCount}`);
        if (query.collectionName === 'territories') this.territoryQueries += 1;
        const prefix = `${query.collectionName}/`;
        let rows = [...this.docs.entries()].filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'));
        for (const filter of query.filters) rows = rows.filter(([, data]) => data[filter.field] === filter.value);
        if (query.limitCount != null) rows = rows.slice(0, query.limitCount);
        return {
          docs: rows.map(([path, data]) => ({ exists: true, id: path.slice(prefix.length), data: () => data })),
        };
      },
      update: (ref, patch) => {
        this.events.push(`update ${ref.path}`);
        this.patches.push({ path: ref.path, patch: revive(patch) });
        queued.push(() => {
          const current = this.docs.get(ref.path);
          if (!current) throw new Error(`missing ${ref.path}`);
          for (const [key, value] of Object.entries(patch)) {
            if (value && typeof value === 'object' && (value as { marker?: string }).marker === 'delete') delete current[key];
            else current[key] = value;
          }
        });
      },
      create: (ref, data) => {
        this.events.push(`create ${ref.path}`);
        this.creates.push({ path: ref.path, data: revive(data) });
        queued.push(() => this.docs.set(ref.path, { ...data }));
      },
    };
    const result = await fn(tx);
    for (const job of queued) job();
    return result;
  }

  private snap(path: string): DispoSnap {
    const data = this.docs.get(path);
    const id = path.slice(path.indexOf('/') + 1);
    if (!data) return { exists: false, id, data: () => undefined };
    return { exists: true, id, data: () => data };
  }
}

class ClaimMem implements ClaimDb {
  docs = new Map<string, Record<string, unknown>>();
  events: string[] = [];
  patches: Array<{ path: string; patch: unknown }> = [];
  creates: Array<{ path: string; data: unknown }> = [];
  territoryQueries = 0;

  put(path: string, data: Record<string, unknown>) {
    this.docs.set(path, { ...data });
  }

  async runTransaction<T>(fn: (tx: ClaimTx) => Promise<T>): Promise<T> {
    const queued: Array<() => void> = [];
    const tx: ClaimTx = {
      get: async (path) => {
        this.events.push(`get ${path}`);
        return this.snap(path);
      },
      update: (path, patch) => {
        this.events.push(`update ${path}`);
        this.patches.push({ path, patch: revive(patch) });
        queued.push(() => Object.assign(this.docs.get(path) ?? {}, patch));
      },
      create: (path, data) => {
        this.events.push(`create ${path}`);
        this.creates.push({ path, data: revive(data) });
        queued.push(() => this.docs.set(path, { ...data }));
      },
    };
    const result = await fn(tx);
    for (const job of queued) job();
    return result;
  }

  territories = async (_tx: ClaimTx, uid: string) => {
    this.territoryQueries += 1;
    this.events.push(`query territories ${TERRITORY_QUERY_LIMIT}`);
    const prefix = 'territories/';
    const docs = [...this.docs.entries()]
      .filter(([path, data]) => path.startsWith(prefix) && data.userId === uid)
      .map(([path, data]) => ({ id: path.slice(prefix.length), data }));
    return { docs: docs.slice(0, TERRITORY_QUERY_LIMIT), truncated: docs.length >= TERRITORY_QUERY_LIMIT };
  };

  private snap(path: string): ClaimSnap {
    const data = this.docs.get(path);
    const id = path.slice(path.indexOf('/') + 1);
    if (!data) return { exists: false, id, data: () => undefined };
    return { exists: true, id, data: () => data };
  }
}

function approved(role: string) {
  return {
    role,
    isActive: true,
    approved: true,
    approvalStatus: 'approved',
    status: 'active',
    email: 'rep@company.com',
    name: 'Jane Rep',
  };
}

type Scenario = {
  name: string;
  block: 'allow' | 'outside_territory' | 'no_territory' | 'territory_unknown' | 'no_coords';
  point: { lat?: number; lng?: number } | null;
  territories: (uid: string) => Array<{ id: string; data: Record<string, unknown> }>;
};

const scenarios: Scenario[] = [
  {
    name: 'inside',
    block: 'allow',
    point: INSIDE,
    territories: (uid) => [{ id: 'mine', data: { userId: uid, polygon: SQUARE } }],
  },
  {
    name: 'outside',
    block: 'outside_territory',
    point: OUTSIDE,
    territories: (uid) => [{ id: 'mine', data: { userId: uid, polygon: SQUARE } }],
  },
  {
    name: 'other-owner',
    block: 'outside_territory',
    point: OUTSIDE,
    territories: (uid) => [
      { id: 'mine', data: { userId: uid, polygon: SQUARE } },
      { id: 'theirs', data: { userId: 'someone-else', polygon: [
        { lat: 19, lng: 19 },
        { lat: 19, lng: 21 },
        { lat: 21, lng: 21 },
        { lat: 21, lng: 19 },
      ] } },
    ],
  },
  {
    name: 'in-none',
    block: 'outside_territory',
    point: OUTSIDE,
    territories: (uid) => [{ id: 'mine', data: { userId: uid, polygon: SQUARE } }],
  },
  {
    name: 'no-territory',
    block: 'no_territory',
    point: INSIDE,
    territories: () => [],
  },
  {
    name: 'archived',
    block: 'no_territory',
    point: INSIDE,
    territories: (uid) => [{ id: 'old', data: { userId: uid, archived: true, polygon: SQUARE } }],
  },
  {
    name: 'short-polygon',
    block: 'no_territory',
    point: INSIDE,
    territories: (uid) => [{ id: 'short', data: { userId: uid, polygon: [{ lat: 10, lng: 10 }, { lat: 12, lng: 12 }] } }],
  },
  {
    name: 'truncated',
    block: 'territory_unknown',
    point: INSIDE,
    territories: (uid) => Array.from({ length: 201 }, (_, index) => ({
      id: `t-${String(index).padStart(3, '0')}`,
      data: { userId: uid, polygon: index === 0 ? SQUARE : [
        { lat: 30 + index, lng: 30 },
        { lat: 30 + index, lng: 31 },
        { lat: 31 + index, lng: 31 },
        { lat: 31 + index, lng: 30 },
      ] },
    })),
  },
  {
    name: 'no-coords',
    block: 'no_coords',
    point: null,
    territories: (uid) => [{ id: 'mine', data: { userId: uid, polygon: SQUARE } }],
  },
  {
    name: 'on-edge',
    block: insideTerritory(ON_EDGE.lat, ON_EDGE.lng, SQUARE) ? 'allow' : 'outside_territory',
    point: ON_EDGE,
    territories: (uid) => [{ id: 'mine', data: { userId: uid, polygon: SQUARE } }],
  },
];

function leadFor(uid: string, scenario: Scenario, extra: Record<string, unknown> = {}) {
  const lead: Record<string, unknown> = {
    hotStatus: 'active',
    notes: 'server copy',
    contacts: [{ name: 'Test Person' }],
    ghl: { opportunityId: 'opp1' },
    ...extra,
  };
  if (scenario.point) {
    lead.lat = scenario.point.lat;
    lead.lng = scenario.point.lng;
  }
  return lead;
}

function installTerritories(db: { put: (path: string, data: Record<string, unknown>) => void }, uid: string, scenario: Scenario) {
  for (const territory of scenario.territories(uid)) db.put(`territories/${territory.id}`, territory.data);
}

async function runDispo(role: string, scenario: Scenario, body: Record<string, unknown>) {
  const db = new Mem();
  const uid = `uid-${role}`;
  db.put(`users/${uid}`, approved(role));
  db.put('dispositions/not-home', { name: 'Not Home' });
  installTerritories(db, uid, scenario);
  db.put('hotLeads/ghl_opp1', leadFor(uid, scenario));
  const deps: FieldDispoDeps = {
    verifyIdToken: async () => ({ uid, email: 'rep@company.com' }),
    getUser: async (id) => {
      const snap = await db.collection('users').doc(id).get();
      return { exists: snap.exists, data: snap.data() };
    },
    db,
    now: () => NOW,
    rateLimitStore: new Map(),
    Timestamp: Stamp,
    serverTimestamp: () => SERVER_TS,
    deleteField: () => DELETED,
  };
  const result = await handleFieldDispo({ authorization: 'Bearer good-token', body, deps });
  return { result, db };
}

async function runClaim(role: string, scenario: Scenario, action: 'claim' | 'release') {
  const db = new ClaimMem();
  const uid = `uid-${role}`;
  db.put(`users/${uid}`, approved(role));
  installTerritories(db, uid, scenario);
  db.put('hotLeads/ghl_opp1', leadFor(uid, scenario, action === 'release' ? { claimedBy: uid, claimedByName: 'Jane Rep' } : {}));
  const result = await handleHotLeadClaim({
    authorization: 'Bearer good-token',
    rawBody: JSON.stringify({
      draftId: `draft-${role}-${scenario.name}-${action}`,
      hotLeadId: 'ghl_opp1',
      action,
      actionAt: ACTION,
      userName: 'Jane Rep',
    }),
    deps: {
      verifyIdToken: async () => ({ uid }),
      getUser: async () => ({ exists: true, data: approved(role) }),
      db,
      territories: db.territories,
      now: () => NOW,
      Timestamp: Stamp,
      serverTimestamp: () => SERVER_TS,
    },
  });
  return { result, db };
}

function knockBody(role: string, scenario: Scenario, extra: Record<string, unknown> = {}) {
  return {
    draftId: `draft-${role}-${scenario.name}-${extra.status ?? 'knock'}`,
    leadId: 'ghl_opp1',
    kind: 'knock',
    actionAt: ACTION,
    status: 'not-home',
    disposition: 'Not Home',
    userName: 'Jane Rep',
    collection: 'hotLeads',
    gps: { lat: INSIDE.lat, lng: INSIDE.lng, accuracyM: 8, capturedAt: ACTION },
    ...extra,
  };
}

describe('3PL territory gate', () => {
  it('documents the edge with insideTerritory and adds no tolerance of its own', () => {
    const source = readFileSync(new URL('../app/utils/server/territoryGate.ts', import.meta.url), 'utf8');
    assert.equal(insideTerritory(ON_EDGE.lat, ON_EDGE.lng, SQUARE), true);
    assert.equal(insideTerritory(9.999, 11, SQUARE), false);
    assert.equal(insideTerritory(INSIDE.lat, INSIDE.lng, SQUARE), true);
    assert.match(source, /insideTerritory\(lat, lng, polygon\)/);
    assert.equal(source.includes('hotLeads'), false);
    assert.equal(source.includes('tolerance'), false);
    assert.equal(source.includes('1e-'), false);
  });

  for (const variant of ['A', 'B'] as const) {
    const allowed = new Set<string>(HOT_LEAD_ROLE_SETS[variant]);
    for (const role of ['setter', 'closer', 'manager', 'admin']) {
      it(`${variant} ${role} knock, status, notes, claim, and release`, async () => {
        await withHotLeadRoles(HOT_LEAD_ROLE_SETS[variant], async () => {
          const staff = role === 'manager' || role === 'admin';
          const roleAllowed = allowed.has(role);
          for (const scenario of scenarios) {
            const expectBlock = roleAllowed ? (staff ? 'allow' : scenario.block) : 'permission_denied';
            const knock = await runDispo(role, scenario, knockBody(role, scenario));
            const status = await runDispo(role, scenario, knockBody(role, scenario, { status: 'interested', disposition: 'Interested' }));
            const notes = await runDispo(role, scenario, {
              draftId: `draft-${role}-${scenario.name}-notes`,
              leadId: 'ghl_opp1',
              kind: 'notes',
              actionAt: ACTION,
              collection: 'hotLeads',
              notes: 'new note',
              baseNotes: 'server copy',
            });
            const claim = await runClaim(role, scenario, 'claim');
            const release = await runClaim(role, scenario, 'release');
            for (const [label, outcome] of [
              ['knock', knock],
              ['status', status],
              ['notes', notes],
              ['claim', claim],
              ['release', release],
            ] as const) {
              const { result, db } = outcome;
              const where = `${variant} ${role} ${scenario.name} ${label}`;
              if (expectBlock === 'permission_denied') {
                assert.equal(result.status, 403, where);
                assert.equal(result.body.reasonCode, 'permission_denied', where);
                assert.equal(db.patches.length, 0, where);
                assert.equal(db.territoryQueries, 0, where);
                continue;
              }
              if (expectBlock === 'allow') {
                assert.equal(result.status, 200, `${where} ${JSON.stringify(result.body)}`);
                assert.equal(result.body.result, 'applied', where);
                assert.equal(db.territoryQueries, staff ? 0 : 1, where);
                const writeAt = db.events.findIndex((event) => event.startsWith('update ') || event.startsWith('create '));
                const queryAt = db.events.findIndex((event) => event.startsWith('query territories'));
                if (!staff) {
                  assert.ok(queryAt >= 0 && writeAt > queryAt, where);
                } else {
                  assert.equal(queryAt, -1, where);
                }
                continue;
              }
              assert.equal(result.status, 403, `${where} ${JSON.stringify(result.body)}`);
              assert.deepEqual(result.body, {
                ok: false,
                error: 'forbidden',
                reasonCode: 'out_of_territory',
                dispoBlock: expectBlock,
              }, where);
              assert.equal(db.patches.length, 0, where);
              assert.equal(db.creates.length, 0, where);
              assert.equal(db.territoryQueries, 1, where);
              assert.equal(db.events.some((event) => event.startsWith('update ') || event.startsWith('create ')), false, where);
            }
          }
        });
      });
    }
  }

  it('pins the 403 body: reasonCode is out_of_territory and the block is only dispoBlock', async () => {
    const blocks = ['outside_territory', 'no_territory', 'territory_unknown', 'no_coords'] as const;
    assert.equal(FIELD_REASON_CODES.includes('out_of_territory'), true);
    for (const block of blocks) {
      assert.equal((FIELD_REASON_CODES as readonly string[]).includes(block), false, block);
    }
    const byName: Record<(typeof blocks)[number], Scenario> = {
      outside_territory: scenarios.find((scenario) => scenario.name === 'outside') as Scenario,
      no_territory: scenarios.find((scenario) => scenario.name === 'no-territory') as Scenario,
      territory_unknown: scenarios.find((scenario) => scenario.name === 'truncated') as Scenario,
      no_coords: scenarios.find((scenario) => scenario.name === 'no-coords') as Scenario,
    };
    for (const block of blocks) {
      const scenario = byName[block];
      const knock = await runDispo('closer', scenario, knockBody('closer', scenario));
      const status = await runDispo('closer', scenario, knockBody('closer', scenario, {
        status: 'interested',
        disposition: 'Interested',
      }));
      const notes = await runDispo('closer', scenario, {
        draftId: `draft-shape-${block}-notes`,
        leadId: 'ghl_opp1',
        kind: 'notes',
        actionAt: ACTION,
        collection: 'hotLeads',
        notes: 'new note',
        baseNotes: 'server copy',
      });
      const claim = await runClaim('closer', scenario, 'claim');
      const release = await runClaim('closer', scenario, 'release');
      for (const [label, outcome] of [
        ['knock', knock.result],
        ['status', status.result],
        ['notes', notes.result],
        ['claim', claim.result],
        ['release', release.result],
      ] as const) {
        assert.equal(outcome.status, 403, `${block} ${label}`);
        assert.deepEqual(Object.keys(outcome.body), ['ok', 'error', 'reasonCode', 'dispoBlock'], `${block} ${label}`);
        assert.deepEqual(outcome.body, {
          ok: false,
          error: 'forbidden',
          reasonCode: 'out_of_territory',
          dispoBlock: block,
        }, `${block} ${label}`);
        assert.equal(outcome.body.reasonCode, 'out_of_territory', `${block} ${label}`);
        assert.notEqual(outcome.body.reasonCode, block, `${block} ${label}`);
      }
    }
  });

  it('replays a stored receipt after the territory is removed', async () => {
    const scenario = scenarios[0];
    const db = new Mem();
    const uid = 'uid-closer';
    db.put(`users/${uid}`, approved('closer'));
    db.put('dispositions/not-home', { name: 'Not Home' });
    installTerritories(db, uid, scenario);
    db.put('hotLeads/ghl_opp1', leadFor(uid, scenario));
    const deps: FieldDispoDeps = {
      verifyIdToken: async () => ({ uid, email: 'rep@company.com' }),
      getUser: async () => ({ exists: true, data: approved('closer') }),
      db,
      now: () => NOW,
      rateLimitStore: new Map(),
      Timestamp: Stamp,
      serverTimestamp: () => SERVER_TS,
      deleteField: () => DELETED,
    };
    const body = knockBody('closer', scenario);
    const first = await handleFieldDispo({ authorization: 'Bearer good-token', body, deps });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const writes = db.patches.length;
    for (const territory of scenario.territories(uid)) db.docs.delete(`territories/${territory.id}`);
    const queries = db.territoryQueries;
    const second = await handleFieldDispo({ authorization: 'Bearer good-token', body, deps });
    assert.equal(second.status, 200);
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.result, 'applied');
    assert.equal(db.patches.length, writes);
    assert.equal(db.territoryQueries, queries);
  });

  it('keeps an ordinary lead on its old rules when the house also has a 3PL pin', async () => {
    const outside = scenarios.find((scenario) => scenario.name === 'outside');
    assert.ok(outside);
    const hot = await runDispo('closer', outside, knockBody('closer', outside));
    assert.equal(hot.result.status, 403);
    assert.equal(hot.result.body.dispoBlock, 'outside_territory');
    assert.equal(hot.db.docs.get('leads/lead-1'), undefined);

    const db = new Mem();
    db.put('users/uid-closer', approved('closer'));
    db.put('leads/lead-1', { lat: OUTSIDE.lat, lng: OUTSIDE.lng, claimedBy: 'uid-closer', notes: 'keep' });
    db.put('hotLeads/ghl_opp1', { lat: OUTSIDE.lat, lng: OUTSIDE.lng, hotStatus: 'active' });
    const deps: FieldDispoDeps = {
      verifyIdToken: async () => ({ uid: 'uid-closer', email: 'rep@company.com' }),
      getUser: async () => ({ exists: true, data: approved('closer') }),
      db,
      now: () => NOW,
      rateLimitStore: new Map(),
      Timestamp: Stamp,
      serverTimestamp: () => SERVER_TS,
      deleteField: () => DELETED,
    };
    const owned = await handleFieldDispo({
      authorization: 'Bearer good-token',
      body: {
        draftId: 'draft-lead',
        leadId: 'lead-1',
        kind: 'knock',
        actionAt: ACTION,
        status: 'not-home',
        disposition: 'Not Home',
        userName: 'Jane Rep',
        collection: 'leads',
        gps: { lat: OUTSIDE.lat, lng: OUTSIDE.lng, accuracyM: 8, capturedAt: ACTION },
      },
      deps,
    });
    assert.equal(owned.status, 200, JSON.stringify(owned.body));
    assert.equal(owned.body.dispoBlock, undefined);
    assert.equal(db.docs.get('hotLeads/ghl_opp1')?.hotStatus, 'active');

    const unownedDb = new Mem();
    unownedDb.put('users/uid-closer', approved('closer'));
    unownedDb.put('leads/lead-1', { lat: OUTSIDE.lat, lng: OUTSIDE.lng });
    const unowned = await handleFieldDispo({
      authorization: 'Bearer good-token',
      body: {
        draftId: 'draft-unowned',
        leadId: 'lead-1',
        kind: 'knock',
        actionAt: ACTION,
        status: 'not-home',
        disposition: 'Not Home',
        userName: 'Jane Rep',
        gps: { lat: OUTSIDE.lat, lng: OUTSIDE.lng, accuracyM: 5, capturedAt: ACTION },
      },
      deps: { ...deps, db: unownedDb, rateLimitStore: new Map() },
    });
    assert.equal(unowned.status, 403);
    assert.deepEqual(unowned.body, { ok: false, error: 'forbidden', reasonCode: 'out_of_territory' });
  });

  it('matches the map capability to the write decision', async () => {
    const calls: string[] = [];
    const windowPolygon = [
      { lat: 10, lng: 10 },
      { lat: 10, lng: 10.04 },
      { lat: 10.03, lng: 10.04 },
      { lat: 10.03, lng: 10 },
    ];
    let random = 7;
    const next = () => {
      random = (random * 16807) % 2147483647;
      return (random - 1) / 2147483646;
    };
    const pins = [
      { id: 'ghl_in', lat: 10.01, lng: 10.02 },
      { id: 'ghl_out', lat: 10.04, lng: 10.06 },
      { id: 'ghl_edge', lat: 10.03, lng: 10.02 },
    ];
    for (let n = 0; n < 12; n += 1) {
      pins.push({ id: `ghl_r${n}`, lat: 10 + next() * 0.05, lng: 10 + next() * 0.08 });
    }
    const missed = await handleHotLeadsGet({
      user: { uid: 'uid-closer', role: 'closer', user: approved('closer') },
      params: new URLSearchParams('mode=map&south=10&north=10.05&west=10&east=10.08&zoom=14'),
      store: {
        async latBand() { return []; },
        async getById() { return null; },
      },
      territories: async (uid) => {
        calls.push(uid);
        return { docs: [], truncated: false };
      },
    });
    assert.equal(missed.status, 400);
    assert.equal(calls.length, 0, 'invalid bounds must not read territories');

    const goodMap = await handleHotLeadsGet({
      user: { uid: 'uid-closer', role: 'closer', user: approved('closer') },
      params: new URLSearchParams('mode=map&south=10&north=10.05&west=10&east=10.08&zoom=16'),
      store: {
        async latBand() {
          return pins.map((pin) => ({
            id: pin.id,
            data: { lat: pin.lat, lng: pin.lng, address: 'x', state: 'NY', hotStatus: 'active', contacts: [] },
          }));
        },
        async getById(id) {
          const pin = pins.find((item) => item.id === id);
          return pin ? { id, data: { lat: pin.lat, lng: pin.lng, hotStatus: 'active', contacts: [] } } : null;
        },
      },
      territories: async (uid) => {
        calls.push(uid);
        return { docs: [{ id: 'mine', data: { userId: uid, polygon: windowPolygon } }], truncated: false };
      },
    });
    assert.equal(goodMap.status, 200);
    assert.equal((goodMap.body.capabilities as { territoryGate: boolean }).territoryGate, true);
    const hotLeads = goodMap.body.hotLeads as Array<{ id: string; canDispo: boolean; dispoBlock: string | null; lat: number; lng: number }>;
    assert.equal(calls.length, 1);
    assert.ok(hotLeads.length >= 3);
    for (const pin of hotLeads) {
      const scenario = {
        name: pin.id,
        block: 'allow' as const,
        point: { lat: pin.lat, lng: pin.lng },
        territories: (uid: string) => [{ id: 'mine', data: { userId: uid, polygon: windowPolygon } }],
      };
      const write = await runDispo('closer', scenario, knockBody('closer', scenario));
      if (write.result.status === 200) {
        assert.equal(pin.canDispo, true, pin.id);
        assert.equal(pin.dispoBlock, null, pin.id);
      } else {
        assert.equal(pin.canDispo, false, pin.id);
        assert.equal(pin.dispoBlock, write.result.body.dispoBlock, pin.id);
      }
    }
    const one = await handleHotLeadsGet({
      user: { uid: 'uid-closer', role: 'closer', user: approved('closer') },
      params: new URLSearchParams('id=ghl_blank'),
      store: {
        async latBand() { return []; },
        async getById() {
          return { id: 'ghl_blank', data: { lat: null, lng: 11, hotStatus: 'active', contacts: [] } };
        },
      },
      territories: async () => {
        calls.push('one');
        return { docs: [{ id: 'mine', data: { userId: 'uid-closer', polygon: SQUARE } }], truncated: false };
      },
    });
    assert.equal(one.status, 200);
    assert.equal((one.body.hotLead as { canDispo: boolean }).canDispo, false);
    assert.equal((one.body.hotLead as { dispoBlock: string }).dispoBlock, 'no_coords');
  });

  it('keeps leads and allowed hot-lead write payloads identical to base', async () => {
    const cases = JSON.parse(readFileSync(new URL('./fixtures/hot-leads/payloads-base.json', import.meta.url), 'utf8')) as Array<{
      name: string;
      request: Record<string, unknown>;
      outcome: { status: number; body: unknown; patches: unknown; creates: unknown };
    }>;
    const box = [
      { lat: 43.0, lng: -77.7 },
      { lat: 43.0, lng: -77.5 },
      { lat: 43.2, lng: -77.5 },
      { lat: 43.2, lng: -77.7 },
    ];
    for (const item of cases) {
      assert.equal(Object.hasOwn(item.request, 'canDispo'), false, item.name);
      assert.equal(Object.hasOwn(item.request, 'dispoBlock'), false, item.name);
      if (item.name.startsWith('hot-claim') || item.name === 'hot-release') {
        const db = new ClaimMem();
        db.put('users/uid-closer', approved('closer'));
        db.put('territories/box', { userId: 'uid-closer', polygon: box });
        db.put('hotLeads/ghl_opp1', {
          lat: 43.1,
          lng: -77.6,
          notes: 'server copy',
          hotStatus: 'active',
          contacts: [{ name: 'Test Person', phone: '5550101' }],
          ghl: { opportunityId: 'opp1' },
          claimedBy: item.name === 'hot-release' ? 'uid-closer' : null,
        });
        const result = await handleHotLeadClaim({
          authorization: 'Bearer good-token',
          rawBody: JSON.stringify(item.request),
          deps: {
            verifyIdToken: async () => ({ uid: 'uid-closer' }),
            getUser: async () => ({ exists: true, data: approved('closer') }),
            db,
            territories: db.territories,
            now: () => NOW,
            Timestamp: Stamp,
            serverTimestamp: () => SERVER_TS,
          },
        });
        assert.equal(result.status, item.outcome.status, item.name);
        assert.deepEqual(revive(result.body), item.outcome.body, item.name);
        assert.deepEqual(db.patches, item.outcome.patches, item.name);
        assert.deepEqual(db.creates, item.outcome.creates, item.name);
        continue;
      }
      const db = new Mem();
      db.put('users/uid-closer', approved('closer'));
      const hot = item.name.startsWith('hot-');
      if (hot) {
        db.put('territories/box', { userId: 'uid-closer', polygon: box });
        db.put('dispositions/not-home', { name: 'Not Home' });
        db.put('hotLeads/ghl_opp1', {
          lat: 43.1,
          lng: -77.6,
          notes: 'server copy',
          hotStatus: 'active',
          contacts: [{ name: 'Test Person', phone: '5550101' }],
          ghl: { opportunityId: 'opp1' },
        });
      } else {
        db.put('leads/lead-1', {
          lat: 43.1,
          lng: -77.6,
          claimedBy: 'uid-closer',
          notes: 'server copy',
          status: 'new',
        });
      }
      const result = await handleFieldDispo({
        authorization: 'Bearer good-token',
        body: item.request,
        deps: {
          verifyIdToken: async () => ({ uid: 'uid-closer', email: 'rep@company.com' }),
          getUser: async () => ({ exists: true, data: approved('closer') }),
          db,
          now: () => NOW,
          rateLimitStore: new Map(),
          Timestamp: Stamp,
          serverTimestamp: () => SERVER_TS,
          deleteField: () => DELETED,
        },
      });
      assert.equal(result.status, item.outcome.status, `${item.name} ${JSON.stringify(result.body)}`);
      assert.deepEqual(revive(result.body), item.outcome.body, item.name);
      assert.deepEqual(db.patches, item.outcome.patches, item.name);
      assert.deepEqual(db.creates, item.outcome.creates, item.name);
    }

    const extra = await handleFieldDispo({
      authorization: 'Bearer good-token',
      body: {
        draftId: 'draft-extra',
        leadId: 'lead-1',
        kind: 'knock',
        actionAt: ACTION,
        status: 'not-home',
        disposition: 'Not Home',
        userName: 'Jane Rep',
        canDispo: true,
      },
      deps: {
        verifyIdToken: async () => ({ uid: 'uid-closer', email: 'rep@company.com' }),
        getUser: async () => ({ exists: true, data: approved('closer') }),
        db: new Mem(),
        now: () => NOW,
        rateLimitStore: new Map(),
        Timestamp: Stamp,
        serverTimestamp: () => SERVER_TS,
        deleteField: () => DELETED,
      },
    });
    assert.equal(extra.status, 400);
    assert.equal(extra.body.field, 'canDispo');
  });

  it('leaves knock count, rules, and indexes byte-identical, and does not read the feature flag', () => {
    const knock = readFileSync(new URL('../app/utils/knockCount.ts', import.meta.url));
    assert.equal(createHash('sha256').update(knock).digest('hex'), 'a00be3335708b5b54605b08f11bd37fb9fa5ada20e3c0cb428d57b58bf1dd226');
    // Re-pinned for the fieldKnockEvents deny-all match (field owner territory PR). Nothing else in the rules changed.
    const rules = readFileSync(new URL('../firestore.rules', import.meta.url));
    assert.equal(createHash('sha256').update(rules).digest('hex'), 'd526c61dbfdd733359b4b3a69012e060f84d401a31dd92f731771e6dc13808b7');
    const indexes = readFileSync(new URL('../firestore.indexes.json', import.meta.url));
    assert.equal(createHash('sha256').update(indexes).digest('hex'), '1020c4a7360e838be82004129460c912e5eb19c4f9ec24e057c7d1bc515e45ea');
    for (const rel of [
      '../app/utils/server/territoryGate.ts',
      '../app/utils/server/fieldDispo.ts',
      '../app/utils/server/hotLeads.ts',
      '../app/api/hot-leads/route.ts',
      '../app/api/hot-leads/claim/route.ts',
    ]) {
      assert.equal(readFileSync(new URL(rel, import.meta.url), 'utf8').includes('NEXT_PUBLIC_HOT_LEADS'), false, rel);
    }
    assert.equal(existsSync(new URL('../app/field/directWrites.ts', import.meta.url)), false);
    assert.equal(existsSync(new URL('../app/field/serverDispo.ts', import.meta.url)), false);
    const claimRoute = readFileSync(new URL('../app/api/hot-leads/claim/route.ts', import.meta.url), 'utf8');
    const getRoute = readFileSync(new URL('../app/api/hot-leads/route.ts', import.meta.url), 'utf8');
    assert.match(claimRoute, /where\('userId', '==', uid\)/);
    assert.match(claimRoute, /limit\(TERRITORY_QUERY_LIMIT\)/);
    assert.match(getRoute, /where\('userId', '==', uid\)/);
    assert.match(getRoute, /limit\(TERRITORY_QUERY_LIMIT\)/);
    assert.equal(TERRITORY_QUERY_LIMIT, 200);
  });
});
