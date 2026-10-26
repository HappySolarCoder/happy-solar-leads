import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LEAD_PAGE,
  LEAD_SELECT_FIELDS,
  alertSubject,
  doorKnockKeys,
  entryIsFar,
  handleTooFarKnockAlert,
  nyDayWindow,
  parseDateParam,
  tallyKnocks,
  type AlertEmail,
  type DispositionDef,
  type LeadPageDoc,
  type TooFarAlertDeps,
} from '../app/utils/server/tooFarKnockAlert';

const SECRET = 'cron-secret';
const ENV = { CRON_SECRET: SECRET, RESEND_API_KEY: 're_test', RESEND_FROM: 'Raydar <alerts@happyslr.com>' };
const H = 3_600_000;
const EDT_2330 = new Date('2026-10-26T03:30:00Z'); // Oct 25, 11:30 PM EDT
type Lead = { id: string; data: Record<string, unknown> };

function req(params: Record<string, string> = {}, auth: string | null = `Bearer ${SECRET}`) {
  return {
    headers: { get: (n: string) => (n.toLowerCase() === 'authorization' ? auth : null) },
    nextUrl: { searchParams: { get: (n: string) => params[n] ?? null } },
  };
}

function rig(opts: { now?: Date; leads?: Lead[]; env?: Record<string, string | undefined>; dispositions?: DispositionDef[]; fullPages?: boolean }) {
  const log = { pages: 0, dispositions: 0, claims: 0, users: 0 };
  const markers = new Set<string>();
  const sent: AlertEmail[] = [];
  const windows: Array<[number, number]> = [];
  const deps: TooFarAlertDeps = {
    env: opts.env ?? ENV,
    now: () => opts.now ?? EDT_2330,
    fetchPage: async (s, e) => {
      log.pages += 1;
      windows.push([s, e]);
      if (opts.fullPages) {
        const docs: LeadPageDoc[] = Array.from({ length: LEAD_PAGE }, (_, i) => ({
          id: `l${log.pages}-${i}`,
          data: () => ({ dispositionHistory: [{ disposition: 'Not Home', timestamp: s + 1, userId: 'rep', gpsFlag: { gpsVerified: false, gpsUnverifiedReason: 'too_far' } }] }),
        }));
        return { size: docs.length, docs };
      }
      const docs = (opts.leads ?? []).map((l) => ({ id: l.id, data: () => l.data }));
      return { size: docs.length, docs };
    },
    getUsers: async (uids) => { log.users += 1; return new Map(uids.map((u) => [u, { name: u }])); },
    getDispositions: async () => { log.dispositions += 1; return opts.dispositions ?? []; },
    claimMarker: async (day) => { log.claims += 1; if (markers.has(day)) return false; markers.add(day); return true; },
    releaseMarker: async (day) => { markers.delete(day); },
    sendEmail: async (m) => { sent.push(m); },
  };
  return { deps, log, markers, sent, windows, run: (p: Record<string, string> = {}, auth?: string | null) => handleTooFarKnockAlert(req(p, auth === undefined ? `Bearer ${SECRET}` : auth), deps) };
}

const flag = (reason?: string, extra: Record<string, unknown> = {}) => ({ gpsFlag: { gpsVerified: !reason, ...(reason ? { gpsUnverifiedReason: reason } : {}), ...extra } });
const entry = (at: number, userId: string, more: Record<string, unknown> = {}) => ({ disposition: 'Not Home', timestamp: at, userId, ...more });
const day = nyDayWindow(EDT_2330);
const s = day.startMs + 15 * H;
const tally = (leads: Lead[], keys?: Set<string>) => tallyKnocks(leads, day.startMs, day.endMs, keys);
const counts = (leads: Lead[], uid = 'u', keys?: Set<string>) => { const t = tally(leads, keys).get(uid); return t ? [t.tooFar, t.total] : [0, 0]; };

describe('#173 fixes: entry-only counting (no top-level fallback)', () => {
  it('top-level too_far + entry out_of_area inside the threshold is not far', () => {
    const lead = { id: 'a', data: { gpsUnverifiedReason: 'too_far', gpsVerified: false, gpsDistanceM: 400, dispositionedAt: s, dispositionHistory: [entry(s, 'u', flag('out_of_area', { gpsDistanceM: 40 }))] } };
    assert.deepEqual(counts([lead]), [0, 1]);
  });
  it('top-level too_far + entry verified is not far', () => {
    const lead = { id: 'a', data: { gpsUnverifiedReason: 'too_far', gpsVerified: false, dispositionedAt: s, dispositionHistory: [entry(s, 'u', flag(undefined, { gpsDistanceM: 10 }))] } };
    assert.deepEqual(counts([lead]), [0, 1]);
  });
  it('entry with no gpsFlag + top-level too_far (even with a fresh knockGpsTimestamp) counts in the total only', () => {
    const lead = { id: 'a', data: { gpsUnverifiedReason: 'too_far', gpsVerified: false, knockGpsTimestamp: s - 1000, dispositionedAt: s, dispositionHistory: [entry(s, 'u')] } };
    assert.deepEqual(counts([lead]), [0, 1]);
  });
  it('select list has no top-level GPS fields and keeps dispositionedAt for startAfter; route uses it', () => {
    assert.deepEqual([...LEAD_SELECT_FIELDS].sort(), ['dispositionHistory', 'dispositionedAt', 'isTestAccount', 'testData']);
    const route = readFileSync(new URL('../app/api/cron/too-far-knocks/route.ts', import.meta.url), 'utf8');
    assert.match(route, /\.select\(\.\.\.LEAD_SELECT_FIELDS\)/);
    assert.match(route, /collection\('dispositions'\)\.get\(\)/);
  });
});

describe('#173 fix 5: out_of_area on the entry', () => {
  const far = (reason: string, extra: Record<string, unknown> = {}) => entryIsFar(entry(s, 'u', flag(reason, extra)));
  it('too_far always counts; quality reasons never count even when distant', () => {
    assert.equal(far('too_far'), true);
    for (const r of ['no_fix', 'stale', 'low_accuracy', 'reduced_accuracy', 'other']) assert.equal(far(r, { gpsDistanceM: 5000 }), false, r);
    assert.equal(entryIsFar(entry(s, 'u')), false);
    assert.equal(entryIsFar(entry(s, 'u', flag(undefined, { gpsDistanceM: 5000 }))), false);
  });
  it('no accuracy on the entry: assume the full 15 m credit (far only when d > 50 m)', () => {
    assert.equal(far('out_of_area', { gpsDistanceM: 50 }), false);
    assert.equal(far('out_of_area', { gpsDistanceM: 50.01 }), true);
    assert.equal(far('out_of_area', { gpsDistanceM: 900 }), true);
  });
  it('with accuracy: d - min(acc, 15) > 35, strict; credit capped at 15', () => {
    assert.equal(far('out_of_area', { gpsDistanceM: 45, gpsAccuracyM: 10 }), false);
    assert.equal(far('out_of_area', { gpsDistanceM: 45.01, gpsAccuracyM: 10 }), true);
    assert.equal(far('out_of_area', { gpsDistanceM: 35, gpsAccuracyM: 0 }), false);
    assert.equal(far('out_of_area', { gpsDistanceM: 35.01, gpsAccuracyM: 0 }), true);
    assert.equal(far('out_of_area', { gpsDistanceM: 50, gpsAccuracyM: 40 }), false);
    assert.equal(far('out_of_area', { gpsDistanceM: 50.5, gpsAccuracyM: 40 }), true);
  });
  it('bad or missing values are ignored for the far count', () => {
    assert.equal(far('out_of_area', { gpsDistanceM: 500, gpsAccuracyM: 66 }), false);
    assert.equal(far('out_of_area', { gpsDistanceM: 500, gpsAccuracyM: 65 }), true);
    assert.equal(far('out_of_area', { gpsDistanceM: 500, gpsAccuracyM: -1 }), false);
    assert.equal(far('out_of_area'), false);
    assert.equal(far('out_of_area', { gpsDistanceM: -5 }), false);
    assert.equal(far('out_of_area', { gpsDistanceM: '900' }), false);
    assert.equal(far('out_of_area', { gpsDistanceM: Number.NaN }), false);
  });
  it('an ignored out_of_area still counts in the total', () => {
    assert.deepEqual(counts([{ id: 'a', data: { dispositionHistory: [entry(s, 'u', flag('out_of_area', { gpsDistanceM: 20 }))] } }]), [0, 1]);
  });
});

describe('#173 fix 4: countsAsDoorKnock', () => {
  it('defaults: Not Home counts, My Targets / Available do not; id and hyphen forms match', () => {
    const keys = doorKnockKeys([]);
    assert.equal(keys.has('not home'), true); assert.equal(keys.has('not-home'), true);
    assert.equal(keys.has('my targets'), false); assert.equal(keys.has('available'), false); assert.equal(keys.has('claimed'), false);
  });
  it('filters both the total and too_far', () => {
    const tf = flag('too_far');
    const lead = { id: 'a', data: { dispositionHistory: [
      entry(s, 'u', tf), { ...entry(s + 1, 'u', tf), disposition: 'My Targets' }, { ...entry(s + 2, 'u', tf), disposition: 'Available' },
      { ...entry(s + 3, 'u', tf), disposition: 'Mystery' }, { ...entry(s + 4, 'u', tf), disposition: undefined }, { ...entry(s + 5, 'u'), disposition: 'not-home' },
    ] } };
    assert.deepEqual(counts([lead]), [1, 2]);
  });
  it('a stored disposition overrides its default; custom knock dispositions count', () => {
    const keys = doorKnockKeys([{ id: 'not-home', name: 'Not Home', countsAsDoorKnock: false }, { id: 'c1', name: 'Left Flyer', countsAsDoorKnock: true }, { id: 'c2', name: 'Drive By', countsAsDoorKnock: 'yes' }]);
    const lead = { id: 'a', data: { dispositionHistory: [entry(s, 'u', flag('too_far')), { ...entry(s + 1, 'u', flag('too_far')), disposition: 'Left Flyer' }, { ...entry(s + 2, 'u'), disposition: 'Drive By' }, { ...entry(s + 3, 'u'), disposition: 'Interested' }] } };
    assert.deepEqual(counts([lead], 'u', keys), [1, 2]);
  });
  it('handler reads dispositions once, and not at all when no leads', async () => {
    const empty = rig({ leads: [] });
    await empty.run({ dryRun: '1' });
    assert.equal(empty.log.dispositions, 0);
    const one = rig({ leads: [{ id: 'a', data: { dispositionHistory: [entry(s, 'u', flag('too_far'))] } }], dispositions: [{ id: 'not-home', name: 'Not Home', countsAsDoorKnock: false }] });
    const r = await one.run({ dryRun: '1' });
    assert.equal(one.log.dispositions, 1);
    assert.deepEqual(r.body.rows, []);
  });
});

describe('#173 fix 2: test leads', () => {
  it('TEST- ids, testData and isTestAccount (any depth) are skipped', () => {
    const tf = flag('too_far');
    const leads: Lead[] = [
      { id: 'TEST-1', data: { dispositionHistory: [entry(s, 'u', tf)] } },
      { id: 'x1', data: { testData: true, dispositionHistory: [entry(s, 'u', tf)] } },
      { id: 'x2', data: { isTestAccount: 'yes', dispositionHistory: [entry(s, 'u', tf)] } },
      { id: 'x3', data: { dispositionHistory: [entry(s, 'u', { ...tf, testData: 1 })] } },
      { id: 'real', data: { testData: false, dispositionHistory: [entry(s, 'u')] } },
    ];
    assert.deepEqual(counts(leads), [0, 1]);
  });
});

describe('#173 fix 3: truncation', () => {
  it('truncated: no marker, no send, 503 truncated:true', async () => {
    const t = rig({ fullPages: true });
    const r = await t.run();
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { ok: false, sent: false, truncated: true, date: '2026-10-25' });
    assert.equal(t.log.pages, 40); assert.equal(t.log.claims, 0); assert.equal(t.sent.length, 0); assert.equal(t.log.users, 0);
  });
  it('truncated dry run previews with truncated:true and sends nothing', async () => {
    const t = rig({ fullPages: true });
    const r = await t.run({ dryRun: '1' });
    assert.equal(r.status, 200); assert.equal(r.body.truncated, true); assert.equal(t.sent.length, 0); assert.equal(t.log.claims, 0);
  });
});

describe('#173 fix 6: NY hour-23 gate (crons 30 3 and 30 4 UTC)', () => {
  const lead: Lead = { id: 'a', data: { dispositionHistory: [] } };
  const cases: Array<[string, boolean]> = [
    ['2026-10-26T03:30:00Z', true], // EDT 23:30
    ['2026-10-26T04:30:00Z', false], // EDT 00:30
    ['2026-10-26T03:59:59Z', true], // Hobby drift, still 23:xx EDT
    ['2026-10-26T04:00:00Z', false],
    ['2026-11-16T03:30:00Z', false], // EST 22:30
    ['2026-11-16T04:30:00Z', true], // EST 23:30
    ['2026-11-02T03:30:00Z', false], // fall-back day evening (EST) 22:30
    ['2026-11-02T04:30:00Z', true],
    ['2026-03-09T03:30:00Z', true], // spring-forward day evening (EDT) 23:30
    ['2026-03-09T04:30:00Z', false],
  ];
  for (const [iso, runs] of cases) {
    it(`${iso} ${runs ? 'runs' : 'skips'}`, async () => {
      const t = rig({ now: new Date(iso), leads: [lead] });
      const r = await t.run();
      assert.equal(r.status, 200);
      if (runs) { assert.equal(r.body.skipped, undefined); assert.equal(t.log.pages, 1); }
      else { assert.equal(r.body.skipped, true); assert.equal(t.log.pages, 0); }
    });
  }
  it('fall-back day run reports Nov 1 as a 25h window', async () => {
    const t = rig({ now: new Date('2026-11-02T04:30:00Z'), leads: [] });
    const r = await t.run();
    assert.equal(r.body.date, '2026-11-01');
    assert.equal((t.windows[0][1] - t.windows[0][0]) / H, 25);
  });
  it('dry run and ?date are not gated; two hour-23 runs still send once', async () => {
    const off = rig({ now: new Date('2026-10-26T04:30:00Z'), leads: [] });
    assert.equal((await off.run({ dryRun: '1' })).body.skipped, undefined);
    assert.equal((await off.run({ date: '2026-10-25' })).body.skipped, undefined);
    const t = rig({ leads: [{ id: 'a', data: { dispositionHistory: [entry(s, 'u', flag('too_far'))] } }] });
    const [a, b] = [await t.run(), await t.run()];
    assert.equal(a.body.sent, true); assert.equal(b.body.alreadySent, true); assert.equal(t.sent.length, 1);
  });
});

describe('#173 fix 7: ?date=YYYY-MM-DD', () => {
  it('valid date gives that NY day window (EDT, EST, DST days); today allowed', () => {
    const now = EDT_2330;
    const oct = parseDateParam('2026-10-24', now)!;
    assert.equal(oct.key, '2026-10-24'); assert.equal(oct.startMs, Date.parse('2026-10-24T04:00:00Z')); assert.equal(oct.endMs, Date.parse('2026-10-25T04:00:00Z'));
    const jan = parseDateParam('2026-01-15', now)!;
    assert.equal(jan.startMs, Date.parse('2026-01-15T05:00:00Z'));
    const mar = parseDateParam('2026-03-08', now)!;
    assert.equal((mar.endMs - mar.startMs) / H, 23);
    assert.equal(parseDateParam('2026-10-25', now)!.key, '2026-10-25');
    const nov = parseDateParam('2026-11-01', new Date('2026-11-02T04:30:00Z'))!;
    assert.equal((nov.endMs - nov.startMs) / H, 25);
  });
  it('rejects bad shapes, impossible days and future days', () => {
    for (const bad of ['', '2026-1-05', '2026-02-30', '2026-13-01', '2026-00-10', '20261024', '2026-10-24T00:00', ' 2026-10-24', '2026-10-24 ', '2026-10-26', '2027-01-01', '1999-12-31', 'yesterday']) {
      assert.equal(parseDateParam(bad, EDT_2330), null, JSON.stringify(bad));
    }
  });
  it('handler: auth first, then 400 with no reads; valid date queries that window', async () => {
    const t = rig({ now: new Date('2026-10-26T15:00:00Z'), leads: [{ id: 'a', data: { dispositionHistory: [entry(Date.parse('2026-10-24T18:00:00Z'), 'u', flag('too_far'))] } }] });
    assert.equal((await t.run({ date: '2026-10-24' }, null)).status, 401);
    assert.equal((await t.run({ date: '2026-10-24' }, 'Bearer nope')).status, 401);
    const bad = await t.run({ date: '2026-02-30' });
    assert.equal(bad.status, 400); assert.equal(bad.body.error, 'invalid_date');
    assert.equal(t.log.pages, 0);
    assert.equal(t.sent.length, 0);
    assert.equal(t.log.claims, 0);
    const dry = await t.run({ date: '2026-10-24', dryRun: '1' });
    assert.equal(dry.status, 200);
    assert.equal(dry.body.dryRun, true);
    assert.equal(dry.body.date, '2026-10-24');
    assert.deepEqual(t.windows[0], [Date.parse('2026-10-24T04:00:00Z'), Date.parse('2026-10-25T04:00:00Z')]);
    assert.equal(t.sent.length, 0);
    assert.equal(t.log.claims, 0);
  });
  it('?date=YYYY-MM-DD without dryRun=1 never sends and never writes the marker', async () => {
    const t = rig({
      now: new Date('2026-10-26T15:00:00Z'),
      env: { CRON_SECRET: SECRET },
      leads: [{ id: 'a', data: { dispositionHistory: [entry(Date.parse('2026-10-24T18:00:00Z'), 'u', flag('too_far'))] } }],
    });
    const live = await t.run({ date: '2026-10-24' });
    assert.equal(live.status, 200);
    assert.equal(live.body.dryRun, true);
    assert.equal(live.body.sent, undefined);
    assert.equal(live.body.alreadySent, undefined);
    assert.equal(live.body.date, '2026-10-24');
    assert.equal((live.body.email as { subject: string }).subject, alertSubject('October 24, 2026'));
    assert.equal((live.body.rows as unknown[]).length, 1);
    assert.equal(t.sent.length, 0);
    assert.equal(t.log.claims, 0);
    assert.equal(t.markers.size, 0);
    const again = await t.run({ date: '2026-10-24' });
    assert.equal(again.status, 200);
    assert.equal(again.body.dryRun, true);
    assert.equal(again.body.alreadySent, undefined);
    assert.equal(t.sent.length, 0);
    assert.equal(t.log.claims, 0);
    assert.equal(t.markers.size, 0);
  });
});

describe('#173 env: dryRun needs only CRON_SECRET', () => {
  const leads: Lead[] = [{ id: 'a', data: { dispositionHistory: [entry(s, 'u', flag('too_far'))] } }];
  it('dry run works without the Resend vars; a real send still 503s with names only', async () => {
    const t = rig({ leads, env: { CRON_SECRET: SECRET } });
    const dry = await t.run({ dryRun: '1' });
    assert.equal(dry.status, 200); assert.equal((dry.body.rows as unknown[]).length, 1); assert.equal(t.sent.length, 0);
    const live = await t.run();
    assert.equal(live.status, 503); assert.deepEqual(live.body, { missing: ['RESEND_API_KEY', 'RESEND_FROM'] });
    assert.equal(t.log.claims, 0); assert.equal(t.sent.length, 0);
  });
  it('no CRON_SECRET: 503 even for a dry run, before any read', async () => {
    const t = rig({ leads, env: { RESEND_API_KEY: 'k', RESEND_FROM: 'x' } });
    const r = await t.run({ dryRun: '1' }, null);
    assert.equal(r.status, 503); assert.deepEqual(r.body, { missing: ['CRON_SECRET'] }); assert.equal(t.log.pages, 0);
  });
  it('subject keeps "over 115 ft"; body has the one-line accuracy credit note', async () => {
    const t = rig({ leads });
    await t.run();
    assert.equal(t.sent[0].subject, 'Raydar: knocks over 115 ft, October 25, 2026');
    assert.match(t.sent[0].html, /minus up to 15 m \(49 ft\) of GPS accuracy credit, is over 35 m \(115 ft\)/);
  });
});
