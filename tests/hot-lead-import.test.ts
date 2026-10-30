import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeStreet } from '../app/homeowners/model';
import {
  addressCacheKey,
  classifyRows,
  executeCli,
  groupHouses,
  homeownerReadPlan,
  houseStreet,
  isDoNotContact,
  collectLeadBand,
  geocodeHouses,
  isCensusCsv,
  leadReadPlan,
  LEAD_HOUSE_CAP,
  LEAD_LAT_DELTA,
  HOMEOWNER_QUERY_LIMIT,
  writeOwnerOnly,
  parseAddressLine,
  pickLink,
  parseTable,
  parseXlsx,
  reimportPatch,
  zipSheets,
  REIMPORT_KEYS,
  reviewCsv,
  runImport,
  sameHouse,
  serializeCache,
  zipStore,
} from '../scripts/hot-leads/logic.mjs';

const FIXTURE = new URL('./fixtures/hot-leads/sample.csv', import.meta.url);
const SECRET_NAME = 'Test Person';
const SECRET_PHONE = '5550101';
const SECRET_EMAIL = 'test.person@example.com';
const SECRET_STREET = 'Main Street';

function census(csv: string, unmatchedNeedle: string) {
  const lines = String(csv).split('\n').filter(Boolean);
  return lines.map((line, index) => {
    const unmatched = line.toLowerCase().includes(unmatchedNeedle);
    if (unmatched) return `${index},"redacted","No_Match"`;
    return `${index},"redacted","Match","Exact","redacted","-77.6100,43.1000","1","L"`;
  }).join('\n');
}

type Stamp = { toMillis: () => number; toDate: () => Date };
type WrittenDoc = {
  hotStatus?: string;
  notes?: string;
  doNotCall?: boolean;
  updatedAt?: Stamp;
  import?: { importedAt?: Stamp; history?: Array<{ at?: Stamp }> };
  ghl?: { createdOn?: Stamp; updatedOn?: Stamp; stage?: string };
};
type ImportWrite = { op: string; id: string; data: WrittenDoc };

function fakeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map(Object.entries(seed));
  const writes: ImportWrite[] = [];
  const plans: unknown[] = [];
  return {
    docs,
    writes,
    plans,
    async get(id: string) {
      return docs.get(id) ?? null;
    },
    async merge(id: string, patch: Record<string, unknown>) {
      writes.push({ op: 'merge', id, data: patch as WrittenDoc });
      docs.set(id, { ...(docs.get(id) ?? {}), ...patch });
    },
    async create(id: string, data: Record<string, unknown>) {
      writes.push({ op: 'create', id, data: data as WrittenDoc });
      docs.set(id, data);
    },
    async retire(id: string, patch: Record<string, unknown>) {
      writes.push({ op: 'retire', id, data: patch as WrittenDoc });
      docs.set(id, { ...(docs.get(id) ?? {}), ...patch });
    },
    async homeownersNear(plan: { queries: Array<{ limit: number }> }) {
      plans.push(plan);
      for (const query of plan.queries) assert.ok(query.limit <= HOMEOWNER_QUERY_LIMIT);
      return [{
        id: 'home-1',
        data: { address: '10 Main Street', city: 'Buffalo', state: 'NY', zip: '14201', lat: 43.1002, lng: -77.6101 },
      }];
    },
    async leadPage(page: { start: number; end: number; limit: number; after: { lat: number; id: string } | null }) {
      plans.push(page);
      const lead = {
        id: 'lead-1',
        data: { address: '10 Main Street Buffalo NY 14201', lat: 43.1001, lng: -77.6100 },
      };
      assert.equal(Object.prototype.hasOwnProperty.call(lead.data, 'geohash'), false);
      if (page.after) return [];
      if (lead.data.lat < page.start || lead.data.lat > page.end) return [];
      return [lead];
    },
    async listHotLeads() {
      return [...docs.entries()].map(([id, data]) => ({ id, hotStatus: data.hotStatus }));
    },
  };
}

describe('hot lead import', () => {
  it('parses addresses, skips rows, and merges a house', () => {
    assert.equal(normalizeStreet('10 Main Street'), houseStreet('10 Main Street Buffalo NY 14201'));
    const parsed = parseAddressLine('20 Elm Drive Albany NY USA');
    assert.equal(parsed?.state, 'NY');
    assert.equal(parsed?.zip, '');
    assert.equal(parsed?.city, 'Albany');
    assert.equal(sameHouse(
      { addressNorm: '10 main st', state: 'NY', zip: '14201' },
      { addressNorm: '10 main st', state: 'ny', zip: '' },
    ), true);
    assert.equal(sameHouse(
      { addressNorm: '10 main st', state: 'NY', zip: '14201' },
      { addressNorm: '10 main st', state: 'NY', zip: '14604' },
    ), false);

    const text = readFileSync(FIXTURE, 'utf8');
    const rows = parseTable(text, 'sample.csv');
    assert.equal(isDoNotContact('Dead/Do not Contact'), true);
    assert.equal(isDoNotContact('DNC'), true);
    assert.equal(isDoNotContact('Do Not Contact'), true);
    assert.equal(isDoNotContact('New'), false);
    const classified = classifyRows(rows, {});
    assert.equal(classified.dncImported, 1);
    assert.equal(classified.skipped.lost, 1);
    assert.equal(classified.skipped.noAddress, 1);
    assert.equal(classified.skipped.duplicate, 1);
    assert.equal(classified.kept.length, 5);
    const grouped = groupHouses(classified.kept);
    assert.equal(grouped.withinSheetMerges, 1);
    assert.equal(grouped.houses.length, 4);
    const dncHouse = grouped.houses.find((house: { id: string }) => house.id === 'ghl_opp-c');
    assert.ok(dncHouse);
    assert.equal(dncHouse.doNotCall, true);
    const merged = grouped.houses.find((house: { id: string }) => house.id === 'ghl_opp-a');
    assert.ok(merged);
    assert.equal(merged.contacts.length, 2);
    assert.equal(merged.contacts.some((contact: { phone?: string }) => contact.phone === SECRET_PHONE), true);
    assert.equal(merged.doNotCall, false);
    const fallback = grouped.houses.find((house: { opportunityId: string }) => house.opportunityId === 'opp-f');
    assert.ok(fallback);
    assert.equal(fallback.address.includes('Oak Avenue'), true);
  });

  it('dry-runs with zero writes and a report that has no fixture pii', async () => {
    const text = readFileSync(FIXTURE, 'utf8');
    const rows = parseTable(text, 'sample.csv');
    const db = fakeDb();
    let throttled = 0;
    const result = await runImport({
      rows,
      commit: false,
      confirm: undefined,
      db,
      batchSize: 1,
      at: '2026-10-30T00:00:00.000Z',
      batchId: 'batch-1',
      throttle: async () => { throttled += 1; },
      fetchBatch: async (csv: string) => census(csv, '20 elm'),
    });
    assert.equal(result.ok, true);
    assert.equal(result.writes, 0);
    assert.equal(db.writes.length, 0);
    const output = result.output as {
      dryRun: boolean;
      rowsRead: number;
      houses: number;
      withinSheetMerges: number;
      geocodeUnmatched: number;
      created: number;
      dncImported: number;
      homeownerLinks: number;
      existingLeadLinks: number;
    };
    assert.equal(output.dryRun, true);
    assert.equal(output.rowsRead, 8);
    assert.equal(output.houses, 4);
    assert.equal(output.withinSheetMerges, 1);
    assert.equal(output.geocodeUnmatched, 1);
    assert.equal(output.created, 3);
    assert.equal(output.dncImported, 1);
    assert.ok(output.homeownerLinks >= 1);
    assert.ok(output.existingLeadLinks >= 1);
    assert.ok(throttled >= 1);
    const report = JSON.stringify(output);
    const review = result.review ?? '';
    for (const secret of [SECRET_NAME, SECRET_PHONE, SECRET_EMAIL, SECRET_STREET, '5550102', '5550103', 'Skip Dnc', 'test.two@example.com', 'Oak Avenue']) {
      assert.equal(report.includes(secret), false, secret);
      assert.equal(review.includes(secret), false, secret);
      assert.equal(serializeCache(result.cache).includes(secret), false, secret);
    }
    assert.match(review, /opp-g,geocode_unmatched/);
    assert.equal(review.includes('Address'), false);
    const ownerPlan = homeownerReadPlan(43.1, -77.61);
    assert.ok(ownerPlan.queries.length > 0);
    assert.ok(ownerPlan.queries.length <= 4);
    assert.equal(ownerPlan.queries[0].limit, HOMEOWNER_QUERY_LIMIT);
    const leads = leadReadPlan(43.1, -77.61);
    assert.equal(leads.orderBy, 'lat');
    assert.ok(Math.abs((leads.end - leads.start) - (2 * LEAD_LAT_DELTA)) < 1e-9);
    assert.equal(leads.cap, LEAD_HOUSE_CAP);
    assert.equal('queries' in leads, false);
  });

  it('refuses commit without the confirm env and limits a confirmed reimport', async () => {
    const refused = await executeCli(['missing.csv', '--commit'], {
      env: {},
      readFile: async () => { throw new Error('should not read'); },
    });
    assert.equal(refused.code, 2);
    assert.deepEqual(refused.output, { error: 'confirm_required', writes: 0 });

    const db = fakeDb({
      'ghl_opp-a': {
        notes: 'keep',
        claimedBy: 'rep-1',
        dispositionHistory: [{ disposition: 'Not Home' }],
        hotStatus: 'worked',
        import: { rowHash: 'old', history: [] },
        ghl: { stage: 'Old' },
      },
      'ghl_left': { hotStatus: 'active', notes: 'stay' },
    });
    const rows = parseTable(readFileSync(FIXTURE, 'utf8'), 'sample.csv');
    const committed = await runImport({
      rows,
      commit: true,
      confirm: 'yes',
      retireMissing: true,
      db,
      at: '2026-10-30T00:00:00.000Z',
      batchId: 'batch-2',
      fetchBatch: async (csv: string) => census(csv, '20 elm'),
      throttle: async () => {},
    });
    assert.equal(committed.ok, true);
    assert.ok(committed.writes > 0);
    const merge = db.writes.find((write) => write.op === 'merge' && write.id === 'ghl_opp-a');
    assert.ok(merge);
    assert.deepEqual(Object.keys(merge.data).sort(), [...REIMPORT_KEYS].sort());
    assert.equal(db.docs.get('ghl_opp-a')?.notes, 'keep');
    assert.equal(db.docs.get('ghl_opp-a')?.claimedBy, 'rep-1');
    assert.equal((db.docs.get('ghl_opp-a')?.dispositionHistory as unknown[]).length, 1);
    const retire = db.writes.find((write) => write.op === 'retire');
    assert.ok(retire);
    assert.equal(retire.data.hotStatus, 'retired');
    const retiredAt = retire.data.updatedAt;
    assert.ok(retiredAt);
    assert.equal(retiredAt.toMillis(), Date.parse('2026-10-30T00:00:00.000Z'));
    assert.equal(typeof retiredAt.toDate, 'function');
    assert.equal(db.docs.get('ghl_left')?.notes, 'stay');
    assert.equal(merge.data.doNotCall, false);
    const dncWrite = db.writes.find((write) => write.op === 'create' && write.id === 'ghl_opp-c');
    assert.ok(dncWrite);
    assert.equal(dncWrite.data.doNotCall, true);
    assert.equal(dncWrite.data.hotStatus, 'active');
    assert.equal(Object.prototype.hasOwnProperty.call(dncWrite.data, 'notes'), false);
    const at = Date.parse('2026-10-30T00:00:00.000Z');
    const writtenAt = dncWrite.data.updatedAt;
    const importedAt = dncWrite.data.import?.importedAt;
    const historyAt = dncWrite.data.import?.history?.[0]?.at;
    const createdOn = dncWrite.data.ghl?.createdOn;
    const updatedOn = dncWrite.data.ghl?.updatedOn;
    assert.ok(writtenAt && importedAt && historyAt && createdOn && updatedOn);
    assert.equal(writtenAt.toMillis(), at);
    assert.equal(importedAt.toMillis(), at);
    assert.equal(historyAt.toMillis(), at);
    assert.equal(createdOn.toMillis(), Date.parse('2026-01-01'));
    assert.equal(updatedOn.toMillis(), Date.parse('2026-01-01'));
    assert.equal(typeof writtenAt.toDate, 'function');
    const patch = reimportPatch(
      { import: { history: [] } },
      { ghl: { stage: 'New' }, batchId: 'b', at: 't', rowHash: 'h' },
    );
    for (const key of ['notes', 'claimedBy', 'dispositionHistory', 'hotStatus', 'contacts']) {
      assert.equal(Object.prototype.hasOwnProperty.call(patch, key), false, key);
    }
  });

  it('round-trips a tiny xlsx without putting the street in the cache key', () => {
    const sheet = `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Opportunity ID</t></is></c><c r="B1" t="inlineStr"><is><t>Address</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>opp-9</t></is></c><c r="B2" t="inlineStr"><is><t>8 Test Street Buffalo NY 14201</t></is></c></row>
    </sheetData></worksheet>`;
    const buffer = zipStore({ 'xl/worksheets/sheet1.xml': sheet });
    const rows = parseXlsx(buffer) as Array<Record<string, string>>;
    assert.equal(rows[0]['Opportunity ID'], 'opp-9');
    const house = { addressNorm: houseStreet('8 Test Street Buffalo NY 14201'), city: 'Buffalo', state: 'NY', zip: '14201' };
    const key = addressCacheKey(house);
    assert.match(key, /^[a-f0-9]{64}$/);
    assert.equal(key.includes('Test'), false);
    const cache = new Map([[key, { lat: 1, lng: 2, quality: 'Exact', address: '8 Test Street' }]]);
    const json = serializeCache(cache);
    assert.equal(json.includes('Test'), false);
    assert.equal(json.includes('address'), false);
    const sheetsXml = `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Opportunity ID</t></is></c><c r="B1" t="inlineStr"><is><t>noise</t></is></c><c r="AA1" t="inlineStr"><is><t>status</t></is></c><c r="AB1" t="inlineStr"><is><t>Address</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>opp-z</t></is></c><c r="B2" t="inlineStr"><is><t>not-lost</t></is></c><c r="AA2" t="inlineStr"><is><t>lost</t></is></c><c r="AB2" t="inlineStr"><is><t>8 Test Street Buffalo NY 14201</t></is></c></row>
    </sheetData></worksheet>`;
    const sheetsRows = parseXlsx(zipSheets({ 'xl/worksheets/sheet1.xml': sheetsXml })) as Array<Record<string, string>>;
    assert.equal(sheetsRows[0]['Opportunity ID'], 'opp-z');
    assert.equal(sheetsRows[0].status, 'lost');
    assert.equal(sheetsRows[0].Address, '8 Test Street Buffalo NY 14201');
    assert.equal(sheetsRows[0].noise, 'not-lost');
    const review = reviewCsv([{ opportunityId: 'opp-9', reason: 'geocode_unmatched', address: '8 Test Street' }]);
    assert.equal(review.includes('Test Street'), false);
    assert.match(review, /^opportunityId,reason\nopp-9,geocode_unmatched\n$/);
  });

  it('does not cache a Census HTML rejection', async () => {
    assert.equal(isCensusCsv('<html>Request Rejected</html>'), false);
    assert.equal(isCensusCsv('Request Rejected'), false);
    const cache = new Map();
    await assert.rejects(() => geocodeHouses([{
      addressNorm: '10 main st',
      city: 'Buffalo',
      state: 'NY',
      zip: '14201',
    }], {
      cache,
      fetchBatch: async () => '<html>Request Rejected</html>',
      throttle: async () => {},
    }));
    assert.equal(cache.size, 0);
    const cli = readFileSync(new URL('../scripts/hot-leads/import.mjs', import.meta.url), 'utf8');
    assert.match(cli, /form\.set\('benchmark', 'Public_AR_Current'\)/);
    assert.equal(cli.includes('addressbatch?benchmark'), false);
  });

  it('links a lead that has latitude and no geohash, and counts a capped band', async () => {
    const lead = {
      id: 'lead-no-geo',
      data: { address: '10 Main Street Buffalo NY 14201', lat: 43.1, lng: -77.61 },
    };
    assert.equal(Object.prototype.hasOwnProperty.call(lead.data, 'geohash'), false);
    const plan = leadReadPlan(43.1, -77.61);
    const linked = await collectLeadBand(async (page: { start: number; end: number; limit: number; after: { lat: number; id: string } | null }) => {
      if (page.after) return [];
      assert.equal(lead.data.lat >= page.start && lead.data.lat <= page.end, true);
      return [lead];
    }, plan);
    assert.equal(linked.capped, false);
    const house = {
      lat: 43.1,
      lng: -77.61,
      addressNorm: '10 main st',
      state: 'NY',
      zip: '14201',
    };
    assert.equal(pickLink(house, linked.docs), 'lead-no-geo');

    let produced = 0;
    const capped = await collectLeadBand(async (page: { start: number; limit: number }) => {
      const batch = [];
      for (let n = 0; n < page.limit; n += 1) {
        produced += 1;
        batch.push({
          id: `far-${produced}`,
          data: { lat: page.start, lng: 0, address: '1 Other Street Buffalo NY 14201' },
        });
      }
      return batch;
    }, plan);
    assert.equal(capped.capped, true);
    assert.equal(capped.scanned, LEAD_HOUSE_CAP);
    assert.equal(capped.docs.length, 0);
  });

  it('writes the geocode cache and review file as owner-only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hot-leads-'));
    const file = join(dir, 'sample.csv.geocode-cache.json');
    try {
      await writeOwnerOnly(file, '{}\n');
      assert.equal(statSync(file).mode & 0o777, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
