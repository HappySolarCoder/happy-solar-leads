import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FieldPath } from 'firebase-admin/firestore';
import { TEAM_AREA_TERRITORY_LIMIT, withTerritoryTruncation } from '../app/api/team-areas/route';
import { MOBILE_TERRITORY_LIMIT, createMobileLeadHandler } from '../app/utils/server/mobileLeads';

type Row = { id: string; data: Record<string, unknown> };

class FakeQuery {
  limitCount: number | null = null;

  constructor(private readonly rows: Row[]) {}

  where(): this { return this; }
  select(): this { return this; }
  orderBy(): this { return this; }
  startAfter(): this { return this; }
  limit(n: number): this {
    this.limitCount = n;
    return this;
  }

  async get() {
    const rows = this.limitCount == null ? this.rows : this.rows.slice(0, this.limitCount);
    return {
      size: rows.length,
      empty: rows.length === 0,
      docs: rows.map((row) => ({
        id: row.id,
        exists: true,
        data: () => row.data,
      })),
    };
  }
}

function square(lat: number, lng: number) {
  const d = 0.01;
  return [
    { lat: lat - d, lng: lng - d },
    { lat: lat - d, lng: lng + d },
    { lat: lat + d, lng: lng + d },
    { lat: lat + d, lng: lng - d },
  ];
}

function mobileDb(options: { territories: Row[]; leads?: Row[]; role?: string }) {
  const queries: FakeQuery[] = [];
  return {
    queries,
    collection(name: string) {
      if (name === 'users') {
        return {
          doc() {
            return {
              async get() {
                return { exists: true, data: () => ({ role: options.role ?? 'setter', isActive: true, approved: true }) };
              },
            };
          },
        };
      }
      const rows = name === 'territories' ? options.territories : (options.leads ?? []);
      return {
        where() {
          const query = new FakeQuery(rows);
          if (name === 'territories') queries.push(query);
          return query;
        },
      };
    },
  };
}

function mapRequest() {
  const params = new URLSearchParams({
    mode: 'map',
    south: '33.44',
    north: '33.46',
    west: '-112.08',
    east: '-112.06',
    zoom: '16',
  });
  return {
    headers: { get: (name: string) => (name === 'authorization' ? 'Bearer token' : null) },
    nextUrl: { searchParams: params },
  } as unknown as Parameters<ReturnType<typeof createMobileLeadHandler>>[0];
}

describe('territory read limit', () => {
  it('marks a team-areas payload truncated when the read hits the limit', () => {
    assert.equal(TEAM_AREA_TERRITORY_LIMIT, 200);
    const full = withTerritoryTruncation({ territories: [], members: [] }, 200);
    assert.equal(full.truncated, true);
    const partial = withTerritoryTruncation({ territories: [], members: [] }, 199);
    assert.equal(Object.hasOwn(partial, 'truncated'), false);
    const source = readFileSync(new URL('../app/api/team-areas/route.ts', import.meta.url), 'utf8');
    assert.match(source, /territoryQuery\.limit\(TEAM_AREA_TERRITORY_LIMIT\)/);
    assert.match(source, /\[team-areas\] territories truncated/);
  });

  it('returns truncated from the mobile map and does not hide the marker on an empty overlap', async () => {
    assert.equal(MOBILE_TERRITORY_LIMIT, 200);
    assert.equal(typeof FieldPath.documentId, 'function');
    const far = Array.from({ length: 200 }, (_, index) => ({
      id: `t-${index}`,
      data: { polygon: square(1, 1), archived: false, userId: 'rep' },
    }));
    const db = mobileDb({ territories: far });
    const handler = createMobileLeadHandler({
      adminAuth: () => ({ verifyIdToken: async () => ({ uid: 'rep' }) }) as never,
      adminDb: () => db as never,
    });
    const result = await handler(mapRequest());
    const body = await result.json();
    assert.equal(result.status, 200);
    assert.equal(body.truncated, true);
    assert.deepEqual(body.leads, []);
    assert.equal(db.queries[0]?.limitCount, 200);
    const source = readFileSync(new URL('../app/utils/server/mobileLeads.ts', import.meta.url), 'utf8');
    assert.match(source, /\.limit\(MOBILE_TERRITORY_LIMIT\)/);
    assert.match(source, /\[mobile\/leads\] territories truncated/);

    const near = mobileDb({
      territories: [{ id: 'mine', data: { polygon: square(33.45, -112.07), archived: false, userId: 'rep' } }],
      leads: [{ id: 'lead-1', data: { lat: 33.45, lng: -112.07, name: 'Ada' } }],
    });
    const shown = createMobileLeadHandler({
      adminAuth: () => ({ verifyIdToken: async () => ({ uid: 'rep' }) }) as never,
      adminDb: () => near as never,
    });
    const shownResult = await shown(mapRequest());
    const shownBody = await shownResult.json();
    assert.equal(shownBody.truncated, undefined);
    assert.equal(shownBody.leads.length, 1);
    assert.equal(near.queries[0]?.limitCount, 200);
  });
});
