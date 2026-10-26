import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEAD_PAGE,
  alertSubject,
  handleTooFarKnockAlert,
  loadDispositionedLeads,
  missingAlertEnv,
  nyDayWindow,
  overFivePercent,
  type AlertEmail,
  type LeadPageDoc,
  type TooFarAlertDeps,
} from '../app/utils/server/tooFarKnockAlert';

const ENV = {
  CRON_SECRET: 'cron-secret',
  RESEND_API_KEY: 're_test',
  RESEND_FROM: 'Raydar <alerts@happyslr.com>',
};

const OCT25_1130_EDT = new Date('2026-10-26T03:30:00.000Z');

function request(headers: Record<string, string> = {}, dryRun = false) {
  const params = new URLSearchParams(dryRun ? { dryRun: '1' } : {});
  return {
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    nextUrl: { searchParams: { get: (name: string) => params.get(name) } },
  };
}

function authed(dryRun = false) {
  return request({ authorization: `Bearer ${ENV.CRON_SECRET}` }, dryRun);
}

type Entry = { at: number; userId: string; userName?: string; reason?: string };

function lead(id: string, at: number, entries: Entry[]) {
  return {
    id,
    dispositionedAt: at,
    dispositionHistory: entries.map((entry) => ({
      disposition: 'Not Home',
      timestamp: entry.at,
      userId: entry.userId,
      userName: entry.userName,
      ...(entry.reason ? { gpsFlag: { gpsVerified: false, gpsUnverifiedReason: entry.reason } } : {}),
    })),
  };
}

function harness(options: {
  now?: Date;
  leads?: ReturnType<typeof lead>[];
  users?: Record<string, Record<string, unknown> | null>;
  env?: Record<string, string | undefined>;
  markerTaken?: boolean;
  sendFails?: boolean;
}) {
  const leads = options.leads ?? [];
  const markers = new Set<string>(options.markerTaken ? ['2026-10-25'] : []);
  const sent: AlertEmail[] = [];
  const queries: Array<{ startMs: number; endMs: number; limit: number }> = [];
  let pages = 0;
  const deps: TooFarAlertDeps = {
    env: options.env ?? ENV,
    now: () => options.now ?? OCT25_1130_EDT,
    fetchPage: async (startMs, endMs) => {
      pages += 1;
      queries.push({ startMs, endMs, limit: LEAD_PAGE });
      const docs: LeadPageDoc[] = leads
        .filter((item) => item.dispositionedAt >= startMs && item.dispositionedAt < endMs)
        .map((item) => ({ id: item.id, data: () => item }));
      return { size: docs.length, docs };
    },
    getUsers: async (uids) => {
      const users = new Map<string, Record<string, unknown> | null>();
      for (const uid of uids) users.set(uid, options.users?.[uid] ?? { name: uid });
      return users;
    },
    getDispositions: async () => [],
    claimMarker: async (day) => {
      if (markers.has(day)) return false;
      markers.add(day);
      return true;
    },
    releaseMarker: async (day) => {
      markers.delete(day);
    },
    sendEmail: async (message) => {
      if (options.sendFails) throw new Error('resend 500');
      sent.push(message);
    },
  };
  return {
    deps,
    sent,
    markers,
    queries,
    pages: () => pages,
    run: (dryRun = false, headers?: Record<string, string>) => (
      handleTooFarKnockAlert(headers ? request(headers, dryRun) : authed(dryRun), deps)
    ),
  };
}

describe('too-far knock alert', () => {
  it('flags more than 5 percent and keeps exactly 5 percent off the list', () => {
    assert.equal(overFivePercent(1, 20), false);
    assert.equal(overFivePercent(1, 19), true);
    assert.equal(overFivePercent(0, 10), false);
  });

  it('uses the America/New_York calendar day, including the EST offset', () => {
    const summer = nyDayWindow(new Date('2026-10-26T03:30:00.000Z'));
    assert.equal(summer.key, '2026-10-25');
    assert.equal(summer.label, 'October 25, 2026');
    assert.equal(summer.startMs, Date.parse('2026-10-25T04:00:00.000Z'));
    assert.equal(summer.endMs, Date.parse('2026-10-26T04:00:00.000Z'));

    const winter = nyDayWindow(new Date('2026-01-16T03:30:00.000Z'));
    assert.equal(winter.key, '2026-01-15');
    assert.equal(winter.startMs, Date.parse('2026-01-15T05:00:00.000Z'));
    assert.equal(winter.endMs, Date.parse('2026-01-16T05:00:00.000Z'));
  });

  it('counts knocks on the NY day and drops the ones outside it', async () => {
    const day = nyDayWindow(OCT25_1130_EDT);
    const test = harness({
      leads: [
        lead('before', day.startMs - 1, [
          { at: day.startMs - 1, userId: 'rep', reason: 'too_far' },
        ]),
        lead('inside', day.startMs, [
          { at: day.startMs, userId: 'rep', userName: 'Ada', reason: 'too_far' },
          { at: day.endMs - 1, userId: 'rep', reason: 'too_far' },
          { at: day.endMs, userId: 'rep', reason: 'too_far' },
          { at: day.startMs + 31_000, userId: 'rep' },
        ]),
      ],
      users: { rep: { name: 'Ada Setter' } },
    });
    const result = await test.run();
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.sent, true);
    assert.equal(result.body.date, '2026-10-25');
    const rows = result.body.rows as Array<{ rep: string; tooFar: number; total: number; percent: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rep, 'Ada Setter');
    assert.equal(rows[0].tooFar, 2);
    assert.equal(rows[0].total, 3);
    assert.equal(test.queries[0].startMs, day.startMs);
    assert.equal(test.queries[0].endMs, day.endMs);
    assert.equal(test.queries[0].limit, LEAD_PAGE);
    assert.equal(test.sent[0].subject, alertSubject('October 25, 2026'));
    assert.match(test.sent[0].html, /knocks over 115 ft/);
    assert.match(test.sent[0].html, /Ada Setter/);
    assert.equal(test.sent[0].to, 'evan@happyslr.com');
  });

  it('sends nothing when nobody is over 5 percent', async () => {
    const day = nyDayWindow(OCT25_1130_EDT);
    const entries: Entry[] = [{ at: day.startMs, userId: 'rep', reason: 'too_far' }];
    for (let i = 0; i < 19; i += 1) entries.push({ at: day.startMs + (i + 1) * 31_000, userId: 'rep' });
    const test = harness({
      leads: [lead('door', day.startMs, entries)],
      users: {
        rep: { name: 'Ada' },
        'user-test-qa': { name: 'Test Rep', email: 'qa@test.com' },
      },
    });
    test.deps.fetchPage = async (startMs, endMs) => {
      const docs = [
        lead('door', day.startMs, entries),
        lead('test-door', day.startMs, [
          { at: day.startMs, userId: 'user-test-qa', reason: 'too_far' },
          { at: day.startMs + 1, userId: 'user-test-qa', reason: 'too_far' },
        ]),
      ].filter((item) => item.dispositionedAt >= startMs && item.dispositionedAt < endMs)
        .map((item) => ({ id: item.id, data: () => item }));
      return { size: docs.length, docs };
    };
    const result = await test.run();
    assert.equal(result.status, 200);
    assert.equal(result.body.sent, false);
    assert.deepEqual(result.body.rows, []);
    assert.equal(test.sent.length, 0);
    assert.equal(test.markers.size, 0);
  });

  it('does not send twice, and a failed send clears the marker', async () => {
    const day = nyDayWindow(OCT25_1130_EDT);
    const leads = [lead('door', day.startMs, [
      { at: day.startMs, userId: 'rep', reason: 'too_far' },
    ])];
    const first = harness({ leads, users: { rep: { name: 'Ada' } } });
    const sentOnce = await first.run();
    assert.equal(sentOnce.body.sent, true);
    assert.equal(first.sent.length, 1);
    const again = await first.run();
    assert.equal(again.body.alreadySent, true);
    assert.equal(again.body.sent, false);
    assert.equal(first.sent.length, 1);

    const failing = harness({ leads, users: { rep: { name: 'Ada' } }, sendFails: true });
    const failed = await failing.run();
    assert.equal(failed.status, 502);
    assert.equal(failing.markers.size, 0);
    failing.deps.sendEmail = async (message) => {
      failing.sent.push(message);
    };
    const retried = await failing.run();
    assert.equal(retried.body.sent, true);
    assert.equal(failing.sent.length, 1);
  });

  it('returns 503 with the missing env names and sends nothing', async () => {
    assert.deepEqual(missingAlertEnv({}), ['CRON_SECRET', 'RESEND_API_KEY', 'RESEND_FROM']);
    const test = harness({ env: { CRON_SECRET: 'cron-secret', RESEND_API_KEY: 're_test' } });
    const result = await test.run();
    assert.equal(result.status, 503);
    assert.deepEqual(result.body.missing, ['RESEND_FROM']);
    assert.equal(test.sent.length, 0);
    assert.equal(test.pages(), 0);

    const open = harness({ env: {} });
    const unconfigured = await open.run(false, {});
    assert.equal(unconfigured.status, 503);
    assert.deepEqual(unconfigured.body.missing, ['CRON_SECRET', 'RESEND_API_KEY', 'RESEND_FROM']);
  });

  it('requires the cron bearer and still previews on dry run', async () => {
    const day = nyDayWindow(OCT25_1130_EDT);
    const test = harness({
      leads: [lead('door', day.startMs, [{ at: day.startMs, userId: 'rep', reason: 'too_far' }])],
      users: { rep: { name: 'Ada <East>' } },
    });
    const missing = await test.run(false, {});
    assert.equal(missing.status, 401);
    const wrong = await test.run(false, { authorization: 'Bearer nope' });
    assert.equal(wrong.status, 401);
    assert.equal(test.sent.length, 0);

    const preview = await test.run(true);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.dryRun, true);
    const email = preview.body.email as AlertEmail;
    assert.equal(email.subject, 'Raydar: knocks over 115 ft, October 25, 2026');
    assert.equal(email.from, ENV.RESEND_FROM);
    assert.match(email.html, /Ada &lt;East&gt;/);
    assert.equal(test.sent.length, 0);
    assert.equal(test.markers.size, 0);

    const live = await test.run();
    assert.equal(live.body.sent, true);
    assert.equal(test.sent.length, 1);
  });

  it('stops after the page cap', async () => {
    let calls = 0;
    const docs: LeadPageDoc[] = Array.from({ length: LEAD_PAGE }, (_, index) => ({
      id: `lead-${index}`,
      data: () => ({}),
    }));
    const loaded = await loadDispositionedLeads(async () => {
      calls += 1;
      return { size: docs.length, docs };
    }, 0, 1);
    assert.equal(calls, 40);
    assert.equal(loaded.truncated, true);
    assert.equal(loaded.leads.length, LEAD_PAGE * 40);
  });
});
