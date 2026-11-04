import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeStreet } from '../app/homeowners/model';
import { insideTerritory as gateInside } from '../app/utils/territoryManager';
import { cliConnections, hotLeadDb } from '../scripts/hot-leads/import.mjs';
import {
  addressCacheKey,
  classifyRows,
  executeCli,
  EXCLUDED_STAGES,
  groupHouses,
  homeownerReadPlan,
  houseStreet,
  insideTerritory,
  isDoNotContact,
  isExcludedStage,
  collectLeadBand,
  geocodeHouses,
  isCensusCsv,
  leadReadPlan,
  LEAD_HOUSE_CAP,
  LEAD_LAT_DELTA,
  HOMEOWNER_QUERY_LIMIT,
  loadTerritoryIndex,
  parseArgs,
  readOnlyFirestore,
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
    assert.equal(classified.skipped.excludedStage, 0);
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

  it('skips Not Interested stages and keeps Dead/Do not Contact', () => {
    assert.deepEqual([...EXCLUDED_STAGES], ['not interested', 'not interested campaign']);
    assert.equal(isExcludedStage(' Not  Interested '), true);
    assert.equal(isExcludedStage('not   interested   campaign'), true);
    assert.equal(isExcludedStage('NOT INTERESTED CAMPAIGN'), true);
    assert.equal(isExcludedStage('Dead/Do not Contact'), false);
    assert.equal(isDoNotContact('  DEAD/DO NOT CONTACT '), true);
    const rows = [
      sheetRow({ 'Opportunity ID': 'keep-1', stage: 'New', Address: '10 Main Street Buffalo NY 14201', 'Contact Name': 'Kept Person' }),
      sheetRow({ 'Opportunity ID': 'ni-1', stage: 'Not Interested', Address: '10 Main Street Buffalo NY 14201', 'Contact Name': 'Dropped Person' }),
      sheetRow({ 'Opportunity ID': 'ni-2', stage: ' Not  Interested ', Address: '12 Elm Drive Albany NY 12207' }),
      sheetRow({ 'Opportunity ID': 'nic-1', stage: 'Not Interested Campaign', Address: '13 Elm Drive Albany NY 12207' }),
      sheetRow({ 'Opportunity ID': 'nic-2', stage: 'not   interested   campaign', Address: '14 Elm Drive Albany NY 12207' }),
      sheetRow({ 'Opportunity ID': 'dnc-1', stage: 'Dead/Do not Contact', Address: '11 Oak Avenue Rochester NY 14604' }),
      sheetRow({ 'Opportunity ID': 'dnc-2', stage: '  DEAD/DO NOT CONTACT ', Address: '16 Oak Avenue Rochester NY 14604' }),
      sheetRow({ 'Opportunity ID': 'lost-ni', stage: 'Not Interested', status: 'lost', Address: '17 Oak Avenue Rochester NY 14604' }),
    ];
    const classified = classifyRows(rows, {});
    assert.equal(classified.skipped.excludedStage, 5);
    assert.equal(classified.skipped.lost, 0);
    assert.equal(classified.dncImported, 2);
    assert.deepEqual(classified.kept.map((row: { opportunityId: string }) => row.opportunityId), ['keep-1', 'dnc-1', 'dnc-2']);
    const kept = classified.kept.find((row: { opportunityId: string; doNotCall: boolean }) => row.opportunityId === 'keep-1');
    assert.ok(kept);
    assert.equal(kept.doNotCall, false);
    assert.equal(classified.kept.filter((row: { opportunityId: string }) => row.opportunityId !== 'keep-1').every((row: { doNotCall: boolean }) => row.doNotCall === true), true);
    const grouped = groupHouses(classified.kept);
    const merged = grouped.houses.find((house: { id: string }) => house.id === 'ghl_keep-1');
    assert.ok(merged);
    assert.equal(merged.contacts.length, 1);
    assert.equal(merged.contacts[0].name, 'Kept Person');
    assert.equal(merged.ghl.stage, 'New');
    assert.equal(merged.doNotCall, false);
    const dnc = grouped.houses.find((house: { id: string; doNotCall: boolean }) => house.id === 'ghl_dnc-1');
    assert.ok(dnc);
    assert.equal(dnc.doNotCall, true);
    assert.equal(grouped.houses.some((house: { opportunityId: string }) => house.opportunityId.startsWith('ni')), false);
    assert.deepEqual(parseArgs(['sheet.csv', '--include-dnc']), { error: 'unknown_flag' });
    const flagged = parseArgs(['sheet.csv', '--territory-report']) as { territoryReport: boolean; commit: boolean };
    assert.equal(flagged.territoryReport, true);
    assert.equal(flagged.commit, false);
  });

  it('matches the territory gate point-in-polygon on shared fixtures', () => {
    const square = box(43, -78, 43.2, -77);
    const fixtures = [
      { lat: 43.1, lng: -77.5, polygon: square },
      { lat: 43, lng: -77.5, polygon: square },
      { lat: 43.2, lng: -77, polygon: square },
      { lat: 44, lng: -70, polygon: square },
      { lat: 43.1, lng: -77.5, polygon: [{ lat: 43, lng: -78 }, { lat: 43.2, lng: -77 }] },
      { lat: Number.NaN, lng: -77.5, polygon: square },
      { lat: 43.1, lng: Number.POSITIVE_INFINITY, polygon: square },
    ];
    for (const fixture of fixtures) {
      assert.equal(
        insideTerritory(fixture.lat, fixture.lng, fixture.polygon),
        gateInside(fixture.lat, fixture.lng, fixture.polygon),
        JSON.stringify(fixture),
      );
    }
    assert.equal(gateInside(43.1, -77.5, square), true);
    assert.equal(gateInside(43, -77.5, square), true);
  });

  it('counts territory pins without writing or leaking ids', async () => {
    const setterBox = box(43, -78, 43.2, -77);
    const closerBox = box(43.05, -77.8, 43.15, -77.2);
    const archivedBox = box(43.5, -71, 44.5, -69);
    assert.equal(gateInside(43.1, -77.5, setterBox), true);
    assert.equal(gateInside(43.1, -77.5, closerBox), true);
    assert.equal(gateInside(44, -70, archivedBox), true);
    assert.equal(gateInside(44, -70, setterBox), false);
    const territories = [
      { polygon: setterBox, userId: 'setter-1', archived: false },
      { polygon: setterBox, userId: 'setter-2', archived: false },
      { polygon: closerBox, userId: 'closer-1', archived: false },
      { polygon: archivedBox, userId: 'admin-1', archived: true },
      { polygon: [{ lat: 43.5, lng: -71 }, { lat: 44.5, lng: -69 }], userId: 'viewer-1', archived: false },
    ];
    const users = {
      'setter-1': 'setter',
      'setter-2': 'setter',
      'closer-1': 'closer',
      'admin-1': 'admin',
      'viewer-1': 'viewer',
    };
    const { api, calls } = territoryFirestore(territories, users);
    const rows = [
      sheetRow({ 'Opportunity ID': 'in-1', stage: 'New', Address: '1 Inside Street Buffalo NY 14201' }),
      sheetRow({ 'Opportunity ID': 'out-1', stage: 'Qualified', Address: '2 Outside Road Buffalo NY 14202' }),
      sheetRow({ 'Opportunity ID': 'miss-1', stage: 'New', Address: '3 Unmatched Drive Buffalo NY 14203' }),
      sheetRow({ 'Opportunity ID': 'dnc-in', stage: 'Dead/Do not Contact', Address: '4 Inside Avenue Buffalo NY 14201' }),
      sheetRow({ 'Opportunity ID': 'ni-1', stage: 'Not Interested', Address: '5 Gone Street Buffalo NY 14201' }),
      sheetRow({ 'Opportunity ID': 'nic-1', stage: 'Not Interested Campaign', Address: '6 Gone Lane Buffalo NY 14201' }),
    ];
    const result = await runImport({
      rows,
      commit: false,
      territoryReport: true,
      territoryDb: api,
      at: '2026-10-30T00:00:00.000Z',
      batchId: 'batch-territory',
      fetchBatch: async (csv: string) => placedCensus(csv),
      throttle: async () => {},
    });
    assert.equal(result.writes, 0);
    const territoryOutput = result.output as ImportReport;
    assert.equal(territoryOutput.skipped.excludedStage, 2);
    assert.equal(calls.gets, 1);
    assert.equal(calls.getAlls, 1);
    assert.equal(calls.writes, 0);
    assert.deepEqual(calls.selects, [['polygon', 'userId', 'archived']]);
    assert.deepEqual(calls.limits, [201]);
    assert.deepEqual(calls.fieldMasks, [['role']]);
    const territory = territoryOutput.territory;
    assert.deepEqual(territory, {
      pins: 3,
      dnc: 1,
      insideAny: 2,
      insideByOwnerRole: { setter: 2, closer: 2, manager: 0, admin: 0, other: 0 },
      insideNone: 1,
      noCoords: 1,
      territoriesRead: 5,
      ownersRead: 5,
    });
    const report = JSON.stringify(territory);
    for (const secret of ['in-1', 'Inside', 'setter-1', '14201', 'ghl_']) {
      assert.equal(report.includes(secret), false, secret);
    }
    const cached = await runImport({
      rows,
      commit: false,
      territoryReport: true,
      territoryDb: api,
      cache: result.cache,
      fetchBatch: async () => { throw new Error('census'); },
      throttle: async () => {},
    });
    const cachedTerritory = (cached.output as ImportReport).territory;
    assert.ok(cachedTerritory);
    assert.equal(cachedTerritory.pins, 3);
    assert.equal(cachedTerritory.noCoords, 1);
    assert.equal(calls.gets, 2);
    assert.equal(calls.getAlls, 2);
  });

  it('refuses more than 200 territories and blocks writes', async () => {
    const tooMany = territoryFirestore(Array.from({ length: 201 }, (_, index) => ({
      polygon: box(0, 0, 1, 1),
      userId: `user-${index}`,
      archived: false,
    })), {});
    await assert.rejects(
      () => loadTerritoryIndex(readOnlyFirestore(tooMany.api)),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'too_many_territories');
        assert.match(String((error as Error).message), /200/);
        return true;
      },
    );
    assert.equal(tooMany.calls.gets, 1);
    assert.equal(tooMany.calls.getAlls, 0);
    assert.equal(tooMany.calls.writes, 0);

    const blocked = territoryFirestore([], {});
    const wrapped = readOnlyFirestore(blocked.api) as unknown as Record<string, (value?: unknown) => void> & {
      collection(name: string): { doc(id: string): Record<string, () => void> };
    };
    for (const method of ['set', 'update', 'delete', 'create', 'add', 'batch', 'bulkWriter', 'runTransaction']) {
      assert.throws(() => wrapped[method](), { code: 'read_only' });
      assert.throws(() => wrapped.collection('territories').doc('x')[method](), { code: 'read_only' });
    }
    assert.equal(blocked.calls.writes, 0);
    const cli = await executeCli(['sheet.csv', '--territory-report'], {
      env: {},
      readFile: async () => 'Opportunity ID,Address,stage,status\n',
      territoryDb: tooMany.api,
      fetchBatch: async () => '',
      throttle: async () => {},
    });
    const cliOutput = cli.output as { error?: string; message?: string; writes?: number };
    assert.equal(cli.code, 1);
    assert.equal(cliOutput.error, 'too_many_territories');
    assert.match(String(cliOutput.message), /200/);
    assert.equal(cliOutput.writes, 0);
  });

  it('keeps a dry run from opening Firestore', async () => {
    assert.deepEqual(cliConnections({ commit: false, confirmed: false, territoryReport: false }), {
      connect: null,
      territory: null,
    });
    assert.equal(cliConnections({ commit: true, confirmed: false, territoryReport: false }).connect, null);
    assert.equal(cliConnections({ commit: false, confirmed: false, territoryReport: true }).territory, 'readonly');
    let opened = 0;
    const result = await executeCli(['sample.csv'], {
      env: {},
      readFile: async () => readFileSync(FIXTURE),
      connect: async () => { opened += 1; return null; },
      territoryConnect: async () => { opened += 1; return null; },
      fetchBatch: async (csv: string) => census(csv, '20 elm'),
      throttle: async () => {},
    });
    assert.equal(opened, 0);
    assert.equal(result.code, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(result.output, 'territory'), false);
  });

  it('writes the same hot lead payload as e850c8d, plus excludedStage', async () => {
    const rows = parseTable(readFileSync(FIXTURE, 'utf8'), 'sample.csv');
    const db = trackingDb();
    const created = await runImport({
      rows,
      commit: true,
      confirm: 'yes',
      db,
      at: '2026-10-30T00:00:00.000Z',
      batchId: 'batch-golden',
      fetchBatch: async (csv: string) => census(csv, '20 elm'),
      throttle: async () => {},
    });
    const createdOutput = created.output as ImportReport;
    assert.equal(createdOutput.skipped.excludedStage, 0);
    const { excludedStage, ...skippedBefore } = createdOutput.skipped;
    assert.equal(excludedStage, 0);
    assert.deepEqual(skippedBefore, { noAddress: 1, lost: 1, duplicate: 1, badId: 0 });
    assert.equal(createdOutput.created, 3);
    assert.equal(createdOutput.dncImported, 1);
    assert.equal(createdOutput.writes, 3);
    assert.equal(Object.prototype.hasOwnProperty.call(created.output, 'territory'), false);
    const create = db.writes.find((write) => write.op === 'create' && write.id === 'ghl_opp-c');
    assert.ok(create);
    assert.deepEqual(stamp(create.data), GOLDEN_CREATE);
    assert.equal(db.leadWrites, 0);
    assert.equal(db.homeownerWrites, 0);
    assert.equal(db.writes.every((write) => write.id.startsWith('ghl_')), true);

    const again = trackingDb({
      'ghl_opp-c': {
        notes: 'keep-me',
        claimedBy: 'rep-9',
        hotStatus: 'worked',
        import: { rowHash: 'old-hash', history: [{ batchId: 'old', at: 'plain', rowHash: 'old-hash' }] },
        ghl: { stage: 'Old' },
      },
    });
    await runImport({
      rows,
      commit: true,
      confirm: 'yes',
      db: again,
      at: '2026-10-30T00:00:00.000Z',
      batchId: 'batch-golden',
      fetchBatch: async (csv: string) => census(csv, '20 elm'),
      throttle: async () => {},
    });
    const patch = again.writes.find((write) => write.op === 'merge' && write.id === 'ghl_opp-c');
    assert.ok(patch);
    assert.deepEqual(stamp(patch.data), GOLDEN_PATCH);
    assert.deepEqual(Object.keys(patch.data).sort(), [...REIMPORT_KEYS].sort());
    assert.equal(again.leadWrites, 0);
    assert.equal(again.homeownerWrites, 0);

    const { db: firestore, writes } = collectionSpy();
    const adapter = hotLeadDb(firestore, { documentId: () => '__name__' });
    await adapter.create('ghl_x', { hotStatus: 'active' });
    await adapter.merge('ghl_x', { doNotCall: true });
    await adapter.retire('ghl_left', { hotStatus: 'retired' });
    await adapter.homeownersNear({ queries: [] });
    await adapter.leadPage({ start: 0, end: 1, limit: 1, after: null });
    assert.deepEqual(writes.map((write) => write.collection), ['hotLeads', 'hotLeads', 'hotLeads']);
    assert.equal(writes.some((write) => write.collection === 'leads' || write.collection === 'homeowners'), false);
  });
});

type ImportReport = {
  skipped: { noAddress: number; lost: number; duplicate: number; badId: number; excludedStage: number };
  created: number;
  dncImported: number;
  writes: number;
  territory?: {
    pins: number;
    dnc: number;
    insideAny: number;
    insideByOwnerRole: { setter: number; closer: number; manager: number; admin: number; other: number };
    insideNone: number;
    noCoords: number;
    territoriesRead: number;
    ownersRead: number;
  };
};

function sheetRow(partial: Record<string, string>): Record<string, string> {
  return {
    'Opportunity ID': '',
    'Contact ID': 'c',
    'Contact Name': 'Synth',
    phone: '5550199',
    email: 'synth@example.com',
    Address: '',
    pipeline: 'Inbound',
    'Pipeline ID': 'pipe-1',
    stage: 'New',
    'Pipeline Stage ID': 'stage-1',
    status: 'open',
    source: 'web',
    'Created on': '2026-01-01',
    'Updated on': '2026-01-02',
    ...partial,
  };
}

function box(south: number, west: number, north: number, east: number) {
  return [
    { lat: south, lng: west },
    { lat: south, lng: east },
    { lat: north, lng: east },
    { lat: north, lng: west },
  ];
}

function placedCensus(csv: string) {
  return csv.split('\n').filter(Boolean).map((line, index) => {
    const text = line.toLowerCase();
    if (text.includes('unmatched')) return `${index},"x","No_Match"`;
    if (text.includes('inside')) return `${index},"x","Match","Exact","x","-77.5,43.1","1","L"`;
    return `${index},"x","Match","Exact","x","-70,44","1","L"`;
  }).join('\n');
}

function territoryFirestore(rows: Array<Record<string, unknown>>, users: Record<string, string>) {
  const calls = {
    gets: 0,
    getAlls: 0,
    writes: 0,
    selects: [] as string[][],
    limits: [] as number[],
    fieldMasks: [] as string[][],
  };
  const api = {
    collection(name: string) {
      const query = {
        select(...fields: string[]) {
          calls.selects.push(fields);
          return query;
        },
        limit(n: number) {
          calls.limits.push(n);
          return query;
        },
        doc(id: string) {
          return { id, path: `${name}/${id}` };
        },
        async get() {
          if (name !== 'territories') return { docs: [], size: 0 };
          calls.gets += 1;
          const docs = rows.slice(0, 201).map((data, index) => ({ id: `t-${index}`, data: () => data }));
          return { docs, size: docs.length };
        },
      };
      return query;
    },
    async getAll(...args: unknown[]) {
      calls.getAlls += 1;
      const mask = args[args.length - 1] as { fieldMask?: string[] };
      calls.fieldMasks.push(mask.fieldMask ?? []);
      const refs = args.slice(0, -1) as Array<{ id: string }>;
      return refs.map((ref) => {
        if (!Object.prototype.hasOwnProperty.call(users, ref.id)) return { exists: false, data: () => undefined };
        return { exists: true, id: ref.id, data: () => ({ role: users[ref.id] }) };
      });
    },
    set() { calls.writes += 1; },
    update() { calls.writes += 1; },
    delete() { calls.writes += 1; },
    create() { calls.writes += 1; },
    add() { calls.writes += 1; },
    batch() { calls.writes += 1; },
    bulkWriter() { calls.writes += 1; },
    runTransaction() { calls.writes += 1; },
  };
  return { api, calls };
}

function stamp(value: unknown): unknown {
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return { __ts: (value as { toMillis: () => number }).toMillis() };
  }
  if (Array.isArray(value)) return value.map(stamp);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stamp((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function trackingDb(seed: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map(Object.entries(seed));
  const writes: Array<{ op: string; id: string; data: Record<string, unknown> }> = [];
  return {
    docs,
    writes,
    leadWrites: 0,
    homeownerWrites: 0,
    async get(id: string) {
      return docs.get(id) ?? null;
    },
    async merge(id: string, patch: Record<string, unknown>) {
      writes.push({ op: 'merge', id, data: patch });
      docs.set(id, { ...(docs.get(id) ?? {}), ...patch });
    },
    async create(id: string, data: Record<string, unknown>) {
      writes.push({ op: 'create', id, data });
      docs.set(id, data);
    },
    async retire(id: string, patch: Record<string, unknown>) {
      writes.push({ op: 'retire', id, data: patch });
    },
    async homeownersNear() {
      return [];
    },
    async leadPage() {
      return [];
    },
    async listHotLeads() {
      return [];
    },
    async writeLead() {
      this.leadWrites += 1;
    },
    async writeHomeowner() {
      this.homeownerWrites += 1;
    },
  };
}

function collectionSpy() {
  const writes: Array<{ collection: string; id: string }> = [];
  const chain = {
    where() { return chain; },
    orderBy() { return chain; },
    limit() { return chain; },
    select() { return chain; },
    startAfter() { return chain; },
    async get() { return { docs: [], size: 0 }; },
  };
  const db = {
    collection(name: string) {
      return {
        ...chain,
        doc(id: string) {
          return {
            async get() { return { exists: false, data: () => undefined }; },
            async set() { writes.push({ collection: name, id }); },
          };
        },
      };
    },
  };
  return { db, writes };
}

const GOLDEN_CREATE = {
  address: '11 Oak Avenue Rochester NY 14604',
  addressNorm: '11 oak ave',
  city: 'Rochester',
  contacts: [{ email: 'skip.dnc@example.com', name: 'Skip Dnc', phone: '5550103' }],
  doNotCall: true,
  geo: { quality: 'Exact', source: 'census' },
  geohash: 'dr8v1yn5ey',
  ghl: {
    contactId: 'c-3',
    createdOn: { __ts: 1767225600000 },
    opportunityId: 'opp-c',
    pipelineId: 'pipe-1',
    pipelineStageId: 'stage-9',
    source: 'web',
    stage: 'Dead/Do not Contact',
    updatedOn: { __ts: 1767225600000 },
  },
  homeownerId: null,
  hotStatus: 'active',
  import: {
    batchId: 'batch-golden',
    history: [{
      at: { __ts: 1793318400000 },
      batchId: 'batch-golden',
      rowHash: '77995449c9d52a9e2402eabc38f72483d2b0b5be7f6fcc8ed294806fed1dd58e',
    }],
    importedAt: { __ts: 1793318400000 },
    rowHash: '77995449c9d52a9e2402eabc38f72483d2b0b5be7f6fcc8ed294806fed1dd58e',
  },
  lat: 43.1,
  linkedLeadId: null,
  lng: -77.61,
  state: 'NY',
  updatedAt: { __ts: 1793318400000 },
  zip: '14604',
};

const GOLDEN_PATCH = {
  doNotCall: true,
  ghl: GOLDEN_CREATE.ghl,
  import: {
    batchId: 'batch-golden',
    history: [
      { at: 'plain', batchId: 'old', rowHash: 'old-hash' },
      {
        at: { __ts: 1793318400000 },
        batchId: 'batch-golden',
        rowHash: '77995449c9d52a9e2402eabc38f72483d2b0b5be7f6fcc8ed294806fed1dd58e',
      },
    ],
    importedAt: { __ts: 1793318400000 },
    rowHash: '77995449c9d52a9e2402eabc38f72483d2b0b5be7f6fcc8ed294806fed1dd58e',
  },
  updatedAt: { __ts: 1793318400000 },
};
