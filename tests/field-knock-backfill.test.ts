import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCountedKnock as appIsCounted, KNOCK_REPEAT_MS as APP_REPEAT } from '../app/utils/knockCount.ts';
import { knockLedgerKey, knockEventFromDoc } from '../app/utils/fieldKnockEvents.ts';
import { countKnocks } from '../app/utils/knockCount.ts';
import {
  buildPlan, parseArgs, isCountedKnock, KNOCK_REPEAT_MS, DEFAULT_SINCE_MS, ledgerKey, summarize, eventData,
} from '../scripts/field-knock-backfill/logic.mjs';
import { execute as executeRaw } from '../scripts/field-knock-backfill/run.mjs';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const execute = executeRaw as (input: any) => Promise<any>;

const T0 = Date.UTC(2026, 10, 3, 18, 0, 0);
const report = (over: Record<string, unknown> = {}) => ({
  id: 'u1_d1', uid: 'u1', userName: 'Rep One', draftId: 'd1', leadId: 'lead-1', intendedStatus: 'not-home',
  actionAt: new Date(T0).toISOString(), outcome: 'refused', reasonCode: 'owned_by_other', ...over,
});

describe('backfill planner', () => {
  it('keeps exclusion sets and the collapse window in parity with knockCount.ts', () => {
    for (const id of ['shade-dq', 'has-solar', 'already-has-solar', 'not-home', 'go-back', 'not-interested', 'claimed', 'assigned', '', 'Not Home', 'appointment']) {
      assert.equal(isCountedKnock(id), appIsCounted(id), id);
    }
    assert.equal(KNOCK_REPEAT_MS, APP_REPEAT);
    assert.equal(ledgerKey('a', 'b', 'c', 5), knockLedgerKey('a', 'b', 'c', 5));
  });

  it('plans only Nov 1+ owned_by_other refusals, events only', () => {
    const plan = buildPlan({
      reports: [
        report(),
        report({ id: 'u1_d2', draftId: 'd2', reasonCode: 'not_found' }),
        report({ id: 'u1_d3', draftId: 'd3', outcome: 'flagged_accepted' }),
        report({ id: 'u1_d4', draftId: 'd4', actionAt: '2026-10-30T12:00:00Z' }),
        report({ id: 'u1_d5', draftId: 'd5', intendedStatus: 'shade-dq' }),
        report({ id: 'u1_d6', draftId: 'd6', intendedStatus: 'already-has-solar' }),
        report({ id: 'u1_d7', draftId: 'd7', uid: '../x' }),
      ],
    });
    assert.equal(plan.total, 1);
    assert.deepEqual(plan.skipped, { other_reason: 1, not_refused: 1, before_since: 1, excluded_disposition: 2, malformed: 1 });
    const doc = plan.docs[0];
    assert.equal(doc.id, 'u1_d1');
    assert.equal(doc.data.source, 'backfill');
    assert.equal(doc.data.backfillRunId, plan.runId);
    assert.equal(doc.data.actionAtMs, T0);
    assert.equal(doc.data.collection, 'leads');
    assert.equal((plan.perRep as Record<string, { events: number }>).u1.events, 1);
    assert.match(plan.runId, /^bf-[0-9a-f]{12}$/);
  });

  it('skips drafts that already have an event, a receipt, or the same history entry; collapses within 120 s', () => {
    const history = new Map([
      ['lead-1', [{ userId: 'u1', disposition: 'Not Home', timestamp: new Date(T0).toISOString() }]],
      ['lead-2', [{ userId: 'u1', disposition: 'Not Home', timestamp: new Date(T0 + 60000).toISOString() }]],
    ]);
    const plan = buildPlan({
      reports: [
        report(),
        report({ id: 'u1_e', draftId: 'e', leadId: 'lead-2' }),
        report({ id: 'u1_ev', draftId: 'ev', leadId: 'lead-3' }),
        report({ id: 'u1_rc', draftId: 'rc', leadId: 'lead-4' }),
        report({ id: 'u1_a', draftId: 'a', leadId: 'lead-5' }),
        report({ id: 'u1_b', draftId: 'b', leadId: 'lead-5', actionAt: new Date(T0 + 119000).toISOString() }),
        report({ id: 'u1_c', draftId: 'c', leadId: 'lead-5', actionAt: new Date(T0 + 121000).toISOString() }),
        report({ id: 'u1_g', draftId: 'g', leadId: 'lead-5', intendedStatus: 'go-back', actionAt: new Date(T0 + 10000).toISOString() }),
      ],
      existingEvents: new Set(['u1_ev']),
      receipts: new Set(['u1_rc']),
      historyByLead: history,
    });
    assert.deepEqual(plan.skipped, {
      already_in_history: 1, collapsed_into_history: 1, event_exists: 1, receipt_exists: 1, collapsed_repeat: 1,
    });
    // a, c (121 s after a) and go-back (different disposition) are kept
    assert.deepEqual(plan.docs.map((d: { id: string }) => d.id), ['u1_a', 'u1_c', 'u1_g']);
  });

  it('the plan is deterministic, and a second run over its own result plans nothing', () => {
    const reports = [report(), report({ id: 'u2_x', uid: 'u2', draftId: 'x', userName: 'Rep Two' })];
    const a = buildPlan({ reports });
    const b = buildPlan({ reports: [...reports].reverse() });
    assert.equal(a.planHash, b.planHash);
    const again = buildPlan({ reports, existingEvents: new Set(a.docs.map((d: { id: string }) => d.id)) });
    assert.equal(again.total, 0);
  });

  it('a backfilled event counts once through the shared ledger, and again once the draft is accepted into history', () => {
    const plan = buildPlan({ reports: [report()] });
    const { actionAtMs, ...rest } = plan.docs[0].data;
    const event = knockEventFromDoc({ ...rest, actionAt: new Date(actionAtMs) });
    assert.ok(event);
    assert.equal(event.key, ledgerKey('lead-1', 'u1', 'not-home', T0));
    const lead = {
      id: 'lead-1',
      dispositionHistory: [{ disposition: 'Not Home', timestamp: new Date(T0).toISOString(), userId: 'u1' }],
    };
    assert.equal(countKnocks([], [], { ledger: [event] }), 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal(countKnocks([lead as any], [], { ledger: [event] }), 1);
  });

  it('eventData carries the live field set plus backfill markers', () => {
    const plan = buildPlan({ reports: [report()] });
    const live = ['uid', 'userName', 'draftId', 'leadId', 'collection', 'disposition', 'dispositionId', 'status', 'reason', 'effectiveOwnerId', 'effectiveOwnerIds', 'ownerSource', 'source'];
    for (const key of live) assert.ok(key in plan.docs[0].data, key);
    assert.deepEqual(Object.keys(eventData({ id: 'x', key: 'k', report: report(), at: T0, dispositionId: 'not-home' }, 'bf-x')).includes('backfillRunId'), true);
  });
});

describe('backfill CLI', () => {
  it('defaults to a read-only dry run and never builds a writer', async () => {
    const args = parseArgs([], {});
    assert.equal(args.commit, false);
    assert.equal(args.sinceMs, DEFAULT_SINCE_MS);
    let writerBuilt = false;
    const lines: string[] = [];
    const out = await execute({
      args,
      reader: fakeReader([report()]),
      makeWriter: () => { writerBuilt = true; throw new Error('no'); },
      log: (l: string) => lines.push(l),
    });
    assert.equal(writerBuilt, false);
    assert.equal(out.summary.wouldCreate, 1);
    assert.equal(out.summary.mode, 'dry-run');
  });

  it('apply needs the confirm env, a full plan hash, and a matching hash', async () => {
    assert.match(parseArgs(['--commit'], {}).errors.join(), /CONFIRM/);
    assert.match(parseArgs(['--commit'], { FIELD_KNOCK_BACKFILL_CONFIRM: 'yes' }).errors.join(), /plan-hash/);
    const dry = await execute({ args: parseArgs([], {}), reader: fakeReader([report()]), makeWriter: () => { throw new Error('no'); }, log: () => {} });
    const bad = parseArgs(['--commit', '--plan-hash', 'a'.repeat(64)], { FIELD_KNOCK_BACKFILL_CONFIRM: 'yes' });
    await assert.rejects(execute({ args: bad, reader: fakeReader([report()]), makeWriter: () => { throw new Error('no'); }, log: () => {} }), /plan hash mismatch/);
    const good = parseArgs(['--commit', '--plan-hash', dry.plan.planHash], { FIELD_KNOCK_BACKFILL_CONFIRM: 'yes' });
    const created: string[][] = [];
    const reports = Array.from({ length: 250 }, (_, i) => report({ id: `u1_n${i}`, draftId: `n${i}`, leadId: `lead-${i}` }));
    const dry250 = await execute({ args: parseArgs([], {}), reader: fakeReader(reports), makeWriter: () => { throw new Error('no'); }, log: () => {} });
    const apply = parseArgs(['--commit', '--plan-hash', dry250.plan.planHash], { FIELD_KNOCK_BACKFILL_CONFIRM: 'yes' });
    const out = await execute({
      args: apply,
      reader: fakeReader(reports),
      makeWriter: () => ({ createEvents: async (b: Array<{ id: string }>) => { created.push(b.map((d) => d.id)); }, deleteEvents: async () => {} }),
      log: () => {},
    });
    assert.deepEqual(created.map((b) => b.length), [100, 100, 50]);
    assert.equal(out.summary.created, 250);
    void good;
  });

  it('undo is a dry run by default and deletes only this run\'s backfill docs', async () => {
    assert.match(parseArgs(['--undo', 'nope'], {}).errors.join(), /run id/);
    const deleted: string[] = [];
    const reader = { ...fakeReader([]), eventsOfRun: async () => [
      { id: 'a', source: 'backfill', backfillRunId: 'bf-0123456789ab' },
      { id: 'b', source: 'live', backfillRunId: 'bf-0123456789ab' },
      { id: 'c', source: 'backfill', backfillRunId: 'bf-ffffffffffff' },
    ] };
    const makeWriter = () => ({ createEvents: async () => {}, deleteEvents: async (ids: string[]) => { deleted.push(...ids); } });
    const dry = await execute({ args: parseArgs(['--undo', 'bf-0123456789ab'], {}), reader, makeWriter, log: () => {} });
    assert.equal(dry.summary.events, 1);
    assert.deepEqual(deleted, []);
    await execute({ args: parseArgs(['--undo', 'bf-0123456789ab', '--commit'], { FIELD_KNOCK_BACKFILL_CONFIRM: 'yes' }), reader, makeWriter, log: () => {} });
    assert.deepEqual(deleted, ['a']);
  });

  it('summary has counts and names only', () => {
    const s = summarize(buildPlan({ reports: [report()] }));
    assert.deepEqual(Object.keys(s).sort(), ['mode', 'perRep', 'planHash', 'runId', 'since', 'skipped', 'wouldCreate']);
    assert.deepEqual(Object.keys(s.perRep[0]).sort(), ['byDisposition', 'events', 'name', 'uid']);
  });
});

function fakeReader(reports: Array<Record<string, unknown>>) {
  return {
    reports: async () => reports,
    existing: async () => new Set<string>(),
    histories: async () => new Map(),
    eventsOfRun: async () => [],
  };
}
