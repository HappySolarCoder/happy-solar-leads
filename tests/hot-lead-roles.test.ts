import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOT_LEAD_ROLE_SETS,
  HOT_LEAD_ROLE_VARIANT,
  isHotLeadRole,
  withHotLeadRoles,
} from '../app/utils/server/hotLeadContract';
import { handleFieldDispo, type DispoDb, type DispoQuery, type DispoSnap, type DispoTransaction, type FieldDispoDeps } from '../app/utils/server/fieldDispo';
import { handleHotLeadClaim, handleHotLeadsGet, type ClaimDb, type ClaimSnap, type ClaimTx, type HotLeadStore } from '../app/utils/server/hotLeads';

const NOW = Date.parse('2026-10-25T16:31:04.120Z');
const ACTION = '2026-10-25T16:31:04.120Z';
const SERVER_TS = { marker: 'server-timestamp' };
const ROOT = new URL('..', import.meta.url).pathname;

class Stamp {
  constructor(readonly ms: number) {}
  toMillis() { return this.ms; }
  static fromMillis(ms: number) { return new Stamp(ms); }
}

function profile(role: string) {
  return {
    uid: `uid-${role}`,
    role,
    user: {
      role,
      isActive: true,
      approved: true,
      approvalStatus: 'approved',
      status: 'active',
      email: 'rep@company.com',
      name: 'Jane Rep',
    },
  };
}

describe('hot lead role variant', () => {
  it('ships variant A', () => {
    assert.equal(HOT_LEAD_ROLE_VARIANT, 'A');
    assert.equal(isHotLeadRole('setter'), false);
    assert.equal(isHotLeadRole('closer'), true);
    assert.equal(isHotLeadRole('manager'), true);
    assert.equal(isHotLeadRole('admin'), true);
  });

  for (const variant of ['A', 'B'] as const) {
    it(`allows the ${variant} role set on map, detail, dispo, and claim`, async () => {
      const allowed = new Set<string>(HOT_LEAD_ROLE_SETS[variant]);
      await withHotLeadRoles(HOT_LEAD_ROLE_SETS[variant], async () => {
        assert.equal(isHotLeadRole('setter'), variant === 'B');
        assert.equal(isHotLeadRole('closer'), true);
        assert.equal(isHotLeadRole('manager'), true);
        assert.equal(isHotLeadRole('admin'), true);
        for (const role of ['setter', 'closer', 'manager', 'admin', 'viewer']) {
          const expectAllowed = allowed.has(role);
          let reads = 0;
          const store: HotLeadStore = {
            async latBand() {
              reads += 1;
              return [{ id: 'ghl_a', data: { lat: 43.1, lng: -77.6, address: '10 Main Street', state: 'NY', hotStatus: 'active', contacts: [] } }];
            },
            async getById(id) {
              reads += 1;
              return { id, data: { lat: 43.1, lng: -77.6, address: '10 Main Street', state: 'NY', hotStatus: 'active', contacts: [{ name: 'Test Person' }] } };
            },
          };
          const map = await handleHotLeadsGet({
            user: profile(role),
            params: new URLSearchParams('mode=map&south=43&north=43.05&west=-77.66&east=-77.58&zoom=16'),
            store,
          });
          const one = await handleHotLeadsGet({
            user: profile(role),
            params: new URLSearchParams('id=ghl_a'),
            store,
          });
          const dispo = await runDispo(role);
          const claim = await runClaim(role);
          if (expectAllowed) {
            assert.equal(map.status, 200, role);
            assert.equal(one.status, 200, role);
            assert.equal(reads, 2, role);
            assert.equal(dispo.status, 200, `${role} ${JSON.stringify(dispo.body)}`);
            assert.equal(claim.status, 200, `${role} ${JSON.stringify(claim.body)}`);
          } else {
            assert.equal(map.status, 403, role);
            assert.equal(one.status, 403, role);
            assert.equal(reads, 0, role);
            assert.equal(dispo.status, 403, role);
            assert.equal(dispo.body.reasonCode, 'permission_denied');
            assert.equal(claim.status, 403, role);
            assert.equal(claim.body.reasonCode, 'permission_denied');
          }
        }
      });
      assert.equal(isHotLeadRole('setter'), HOT_LEAD_ROLE_VARIANT === 'B');
    });
  }

  it('does not list hot-lead roles outside the variant switch', () => {
    const roleList = /\[\s*['"](?:setter['"]\s*,\s*['"])?closer['"]\s*,\s*['"]manager['"]\s*,\s*['"]admin['"]\s*\]/;
    const files = [
      ...walk(join(ROOT, 'app/hotLeads')),
      ...walk(join(ROOT, 'app/utils/server')).filter((path) => /\/hotLead[^/]*$/.test(path)),
    ];
    const hits: string[] = [];
    for (const path of files) {
      let text = readFileSync(path, 'utf8');
      if (path.endsWith(`${join('app/utils/server', 'hotLeadContract.ts')}`)) {
        text = text.replace(/export const HOT_LEAD_ROLE_SETS = \{[\s\S]*?\} as const;/, '');
      }
      if (roleList.test(text)) hits.push(path.slice(ROOT.length));
    }
    assert.deepEqual(hits, []);
  });

  it('leaves knockCount.ts byte-identical to main', () => {
    const bytes = readFileSync(new URL('../app/utils/knockCount.ts', import.meta.url));
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash, 'a00be3335708b5b54605b08f11bd37fb9fa5ada20e3c0cb428d57b58bf1dd226');
  });
});

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|mjs|js)$/.test(path)) out.push(path);
  }
  return out;
}

function runDispo(role: string) {
  const db = new DispoMem();
  const uid = `uid-${role}`;
  db.put(`users/${uid}`, profile(role).user);
  db.put(`territories/${uid}-box`, {
    userId: uid,
    polygon: [
      { lat: 43.0, lng: -77.7 },
      { lat: 43.0, lng: -77.5 },
      { lat: 43.2, lng: -77.5 },
      { lat: 43.2, lng: -77.7 },
    ],
  });
  db.put('hotLeads/ghl_opp1', {
    lat: 43.1,
    lng: -77.6,
    hotStatus: 'active',
    contacts: [{ name: 'Test Person' }],
    ghl: { opportunityId: 'opp1' },
  });
  db.put('dispositions/not-home', { name: 'Not Home' });
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
    deleteField: () => ({ marker: 'delete' }),
  };
  return handleFieldDispo({
    authorization: 'Bearer good-token',
    body: {
      draftId: `draft-${role}`,
      leadId: 'ghl_opp1',
      kind: 'knock',
      actionAt: ACTION,
      status: 'not-home',
      disposition: 'Not Home',
      userName: 'Jane Rep',
      collection: 'hotLeads',
      gps: { lat: 43.1, lng: -77.6, accuracyM: 8, capturedAt: ACTION },
    },
    deps,
  });
}

function runClaim(role: string) {
  const db = new ClaimMem();
  const uid = `uid-${role}`;
  db.put(`users/${uid}`, profile(role).user);
  db.put(`territories/${uid}-box`, {
    userId: uid,
    polygon: [
      { lat: 43.0, lng: -77.7 },
      { lat: 43.0, lng: -77.5 },
      { lat: 43.2, lng: -77.5 },
      { lat: 43.2, lng: -77.7 },
    ],
  });
  db.put('hotLeads/ghl_opp1', { lat: 43.1, lng: -77.6, hotStatus: 'active', notes: 'keep' });
  return handleHotLeadClaim({
    authorization: 'Bearer good-token',
    rawBody: JSON.stringify({
      draftId: `draft-${role}`,
      hotLeadId: 'ghl_opp1',
      action: 'claim',
      actionAt: ACTION,
      userName: 'Jane Rep',
    }),
    deps: {
      verifyIdToken: async () => ({ uid }),
      getUser: async () => ({ exists: true, data: db.docs.get(`users/${uid}`) }),
      db,
      territories: async (_tx, ownerId) => {
        const prefix = 'territories/';
        const docs = [...db.docs.entries()]
          .filter(([path, data]) => path.startsWith(prefix) && data.userId === ownerId)
          .map(([path, data]) => ({ id: path.slice(prefix.length), data }));
        return { docs: docs.slice(0, 200), truncated: docs.length >= 200 };
      },
      now: () => NOW,
      Timestamp: Stamp,
      serverTimestamp: () => SERVER_TS,
    },
  });
}

class DispoMem implements DispoDb {
  docs = new Map<string, Record<string, unknown>>();
  patches: Array<Record<string, unknown>> = [];

  put(path: string, data: Record<string, unknown>) {
    this.docs.set(path, { ...data });
  }

  collection(name: string) {
    const query = (limitCount: number | null): DispoQuery => ({
      kind: 'query',
      collectionName: name,
      filters: [],
      limitCount,
      limit: (n: number) => query(n),
    });
    return {
      name,
      doc: (id: string) => ({
        id,
        path: `${name}/${id}`,
        get: async () => this.snap(`${name}/${id}`),
      }),
      where: () => query(null),
      cappedGet: (n: number) => query(n),
    };
  }

  async runTransaction<T>(fn: (tx: DispoTransaction) => Promise<T>): Promise<T> {
    const queued: Array<() => void> = [];
    const tx: DispoTransaction = {
      get: async (ref) => this.snap(ref.path),
      getQuery: async (query) => {
        const prefix = `${query.collectionName}/`;
        const rows = [...this.docs.entries()].filter(([path]) => path.startsWith(prefix));
        return { docs: rows.map(([path, data]) => ({ exists: true, id: path.slice(prefix.length), data: () => data })) };
      },
      update: (ref, patch) => {
        this.patches.push(patch);
        queued.push(() => Object.assign(this.docs.get(ref.path) ?? {}, patch));
      },
      create: (ref, data) => {
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

  put(path: string, data: Record<string, unknown>) {
    this.docs.set(path, { ...data });
  }

  async runTransaction<T>(fn: (tx: ClaimTx) => Promise<T>): Promise<T> {
    const queued: Array<() => void> = [];
    const tx: ClaimTx = {
      get: async (path) => this.snap(path),
      update: (path, patch) => {
        queued.push(() => Object.assign(this.docs.get(path) ?? {}, patch));
      },
      create: (path, data) => {
        queued.push(() => this.docs.set(path, { ...data }));
      },
    };
    const result = await fn(tx);
    for (const job of queued) job();
    return result;
  }

  private snap(path: string): ClaimSnap {
    const data = this.docs.get(path);
    const id = path.slice(path.indexOf('/') + 1);
    if (!data) return { exists: false, id, data: () => undefined };
    return { exists: true, id, data: () => data };
  }
}
