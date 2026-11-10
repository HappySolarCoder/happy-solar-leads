import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Lead } from '../app/types/index.ts';
import { phoenixDayWindow } from '../app/utils/phoenixDay.ts';
import {
  countDashboardKnocks,
  countSetterKnocks,
  dashboardTodayKnocks,
  knockIndex,
  setFieldKnockEventLedger,
  teamMapBoard,
} from '../app/utils/webKnockCounts.ts';
import { ledgerFromFieldEvents, knockLedgerKey } from '../app/utils/fieldKnockEvents.ts';
import {
  FIELD_EVENTS_STAFF_LIMIT,
  handleFieldKnockEventsGet,
  staffEventsQuery,
} from '../app/utils/server/fieldKnockEventsRead.ts';
import { EXP_GO_BACK, ownerDisplayColor } from '../app/utils/effectiveOwner.ts';

const NOW = new Date('2026-11-10T20:00:00.000Z');
const day = phoenixDayWindow(NOW);
const T0 = day.startMs + 3 * 60 * 60 * 1000;
const stamp = (ms: number) => ({ toMillis: () => ms });
const ev = (uid: string, leadId: string, ms: number, dispositionId = 'not-home', extra: Record<string, unknown> = {}) => ({
  uid, leadId, dispositionId, actionAt: stamp(ms), ...extra,
});
const lead = (id: string, history: Array<{ userId: string; disposition: string; at: number }>): Lead =>
  ({
    id,
    status: 'not-home',
    dispositionHistory: history.map((h) => ({ userId: h.userId, disposition: h.disposition, timestamp: new Date(h.at) })),
  }) as unknown as Lead;

afterEach(() => setFieldKnockEventLedger([]));

describe('web counts union history and fieldKnockEvents', () => {
  it('no events: counts are exactly the history counts', () => {
    const leads = [lead('l1', [{ userId: 'u1', disposition: 'Not Home', at: T0 }])];
    assert.equal(countDashboardKnocks(leads, [], NOW), 1);
    setFieldKnockEventLedger([]);
    assert.equal(countDashboardKnocks(leads, [], NOW), 1);
  });

  it('an event adds a knock for the knocker, in every counter', () => {
    const leads = [lead('l1', [{ userId: 'u1', disposition: 'Not Home', at: T0 }])];
    setFieldKnockEventLedger(ledgerFromFieldEvents([ev('u2', 'l9', T0 + 60_000)]));
    assert.equal(countDashboardKnocks(leads, [], NOW), 2);
    const today = dashboardTodayKnocks(leads, [], NOW);
    assert.equal(today.byUser.get('u2'), 1);
    assert.equal(countSetterKnocks(leads, [], 'today', NOW).u2, 1);
    assert.equal(teamMapBoard(leads, [], 'today', NOW).get('u2')?.doors, 1);
  });

  it('dedupes by key: the same draft counted_only and later in history counts once', () => {
    const leads = [lead('l1', [{ userId: 'u1', disposition: 'Not Home', at: T0 }])];
    setFieldKnockEventLedger(ledgerFromFieldEvents([ev('u1', 'l1', T0)]));
    assert.equal(countDashboardKnocks(leads, [], NOW), 1);
    const index = knockIndex(leads, []);
    assert.equal(index.events.length, 1);
    assert.equal(index.events[0].at, T0);
  });

  it('120 s collapse after dedupe: same rep+dispo+lead within 120 s is one, later is another', () => {
    const leads = [lead('l1', [{ userId: 'u1', disposition: 'Not Home', at: T0 }])];
    setFieldKnockEventLedger(ledgerFromFieldEvents([ev('u1', 'l1', T0 + 60_000), ev('u1', 'l1', T0 + 300_000)]));
    assert.equal(countDashboardKnocks(leads, [], NOW), 2);
  });

  it('Shade DQ and Already Has Solar events never count', () => {
    setFieldKnockEventLedger(ledgerFromFieldEvents([
      ev('u1', 'l1', T0, 'shade-dq'),
      ev('u1', 'l2', T0, 'has-solar'),
      ev('u1', 'l3', T0, 'already-has-solar'),
      ev('u1', 'l4', T0, 'not-home'),
    ]));
    assert.equal(countDashboardKnocks([], [], NOW), 1);
  });

  it('a counts-only event never subtracts', () => {
    const leads = [lead('l1', [{ userId: 'u1', disposition: 'Not Home', at: T0 }, { userId: 'u1', disposition: 'Interested', at: T0 + 400_000 }])];
    const before = countDashboardKnocks(leads, [], NOW);
    setFieldKnockEventLedger(ledgerFromFieldEvents([ev('u1', 'l1', T0 + 900_000, 'not-interested')]));
    assert.equal(countDashboardKnocks(leads, [], NOW), before + 1);
  });

  it('the ledger key is the fallback key, never the draft id', () => {
    const [row] = ledgerFromFieldEvents([ev('u1', 'l1', T0, 'not-home', { draftId: 'abc' })]);
    assert.equal(row.key, knockLedgerKey('l1', 'u1', 'not-home', T0));
    assert.equal(row.key.includes('abc'), false);
  });
});

describe('/api/field-knock-events handler', () => {
  const user = (role: string) => ({ exists: true, data: { role, isActive: true, approved: true } });
  const run = (role: string, rows: Array<Record<string, unknown>>, sinceParam: string | null = null, uid = 'u1') => {
    const calls: string[] = [];
    return handleFieldKnockEventsGet({
      authorization: 'Bearer t',
      sinceParam,
      deps: {
        verifyIdToken: async () => ({ uid }),
        getUser: async () => user(role),
        now: () => NOW.getTime(),
        loadSince: async (since, limit) => { calls.push(`since:${since}:${limit}`); return rows; },
        loadOwn: async (own, limit) => { calls.push(`own:${own}:${limit}`); return rows; },
      },
    }).then((result) => ({ result, calls }));
  };
  const rows = [ev('u1', 'l1', T0), ev('u2', 'l2', T0 + 1000), ev('u1', 'l3', T0 + 2000, 'shade-dq')];

  it('staff read everyone in one bounded range query', async () => {
    const { result, calls } = await run('admin', rows);
    assert.equal(result.status, 200);
    assert.equal(result.body.scope, 'all');
    assert.deepEqual((result.body.events as Array<{ leadId: string }>).map((e) => e.leadId), ['l2', 'l1']);
    assert.equal(calls.length, 1);
    assert.match(calls[0], new RegExp(`:${FIELD_EVENTS_STAFF_LIMIT}$`));
  });

  it('reps only ever receive their own rows', async () => {
    const { result, calls } = await run('setter', rows);
    assert.equal(result.body.scope, 'own');
    assert.deepEqual((result.body.events as Array<{ uid: string }>).map((e) => e.uid), ['u1']);
    assert.match(calls[0], /^own:u1:600$/);
  });

  it('clamps since to 400 days and rejects junk', async () => {
    const { calls } = await run('admin', [], '0');
    assert.equal(Number(calls[0].split(':')[1]), NOW.getTime() - 400 * 86_400_000);
    assert.equal((await run('admin', [], 'abc')).result.status, 400);
  });

  it('staff query is newest-first, so the cap drops the OLDEST events', async () => {
    // Fake Firestore: honors where/orderBy/limit over 3,500 events.
    const all = Array.from({ length: 3500 }, (_, i) => ev('u1', `l${i}`, T0 + i * 1000, 'not-home'));
    const log: string[] = [];
    const run2 = (sinceMs: number, limit: number) => {
      let dir: 'asc' | 'desc' = 'asc';
      let cap = Infinity;
      const chain = {
        orderBy: (f: string, d: 'asc' | 'desc') => { log.push(`orderBy:${f}:${d}`); dir = d; return chain; },
        select: () => chain,
        limit: (n: number) => { cap = n; return chain; },
        get: () => {
          const rows = all.filter((r) => (r.actionAt as { toMillis(): number }).toMillis() >= sinceMs);
          rows.sort((a, b) => ((a.actionAt as { toMillis(): number }).toMillis() - (b.actionAt as { toMillis(): number }).toMillis()) * (dir === 'desc' ? -1 : 1));
          return rows.slice(0, cap);
        },
      };
      const root = { where: (f: string, op: string) => { log.push(`where:${f}:${op}`); return chain; } };
      return staffEventsQuery<{ get(): Array<Record<string, unknown>> }>(root, stamp(sinceMs), ['uid'], limit);
    };
    const result = await handleFieldKnockEventsGet({
      authorization: 'Bearer t',
      sinceParam: String(T0),
      deps: {
        verifyIdToken: async () => ({ uid: 'admin1' }),
        getUser: async () => user('admin'),
        now: () => NOW.getTime(),
        loadSince: async (since, limit) => run2(since, limit).get(),
        loadOwn: async () => [],
      },
    });
    const events = result.body.events as Array<{ leadId: string; at: number }>;
    assert.deepEqual(log, ['where:actionAt:>=', 'orderBy:actionAt:desc']);
    assert.equal(events.length, FIELD_EVENTS_STAFF_LIMIT);
    assert.equal(result.body.truncated, true);
    assert.equal(events[0].leadId, 'l3499', 'the newest event is kept');
    assert.equal(events[events.length - 1].leadId, 'l500', 'the 500 oldest were dropped');
    assert.ok(events.every((e, i) => i === 0 || events[i - 1].at >= e.at), 'response is newest-first');
  });

  it('under the cap there is no truncated flag', async () => {
    const { result } = await run('admin', rows);
    assert.equal('truncated' in result.body, false);
  });

  it('401 without a token', async () => {
    const result = await handleFieldKnockEventsGet({
      authorization: null,
      sinceParam: null,
      deps: { verifyIdToken: async () => ({ uid: 'x' }), getUser: async () => user('admin'), loadSince: async () => [], loadOwn: async () => [] },
    });
    assert.equal(result.status, 401);
  });
});

describe('display helpers', () => {
  it('Exp. Go-Back is a fixed system pin type', () => {
    assert.deepEqual(EXP_GO_BACK, { id: 'exp-go-back', label: 'Exp. Go-Back', color: '#a16207', icon: '\u21ba' });
  });
  it('dual owners: the viewer sees their own color, others see the first owner', () => {
    const color = (id: string) => ({ a: '#aaa', b: '#bbb' } as Record<string, string>)[id];
    assert.equal(ownerDisplayColor(['a', 'b'], 'b', color), '#bbb');
    assert.equal(ownerDisplayColor(['a', 'b'], 'zzz', color), '#aaa');
    assert.equal(ownerDisplayColor(['x', 'b'], undefined, color), '#bbb');
    assert.equal(ownerDisplayColor([], 'b', color), undefined);
  });
});
