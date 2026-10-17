import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAfter, startOfMonth, startOfToday, startOfWeek } from 'date-fns';
import { handleAllLeadsStats, STATS_SELECT_FIELDS, STATS_WINDOW_MS } from '../app/utils/server/allLeadsStats.ts';
import {
  buildTeamPerfLeadQuery,
  handleTeamPerformance,
  teamPerfCacheKey,
  type TeamPerfDeps,
  type TeamPerfResponse,
} from '../app/utils/server/teamPerformance.ts';
import {
  isExcludedTestUser,
  TIME_RANGES,
  type Counters,
  type TimeRange,
} from '../app/utils/teamStats/aggregate.ts';
import type { RequireApprovedUserDeps } from '../app/utils/server/requireApprovedUser.ts';
import type { TeamPerfCache, TeamPerfCacheOptions } from '../app/utils/server/teamPerfCache.ts';

const NOW = new Date('2026-10-17T15:00:00.000Z');
const COUNTER_KEYS = [
  'knocks',
  'conversations',
  'appointments',
  'sales',
  'notHome',
  'notInterested',
  'goBacksScheduled',
  'goBacksConverted',
] as const;

const SETTER_KEYS = ['userId', ...COUNTER_KEYS];
const PII_KEYS = ['id', 'name', 'address', 'phone', 'email', 'lat', 'lng', 'notes', 'dispositionHistory'];

type LeadDoc = { id: string; data: Record<string, unknown> };
type UserDoc = { id: string; data: Record<string, unknown> };

function authDeps(role: string, flags: Record<string, unknown> = {}): RequireApprovedUserDeps {
  return {
    verifyIdToken: async () => ({ uid: 'uid-' + role, email: role + '@example.com' }),
    getUser: async () => ({
      exists: true,
      data: { role, approved: true, isActive: true, approvalStatus: 'approved', ...flags },
    }),
  };
}

function createCache(): TeamPerfCache & {
  store: Map<string, { value: unknown; options?: TeamPerfCacheOptions }>;
  gets: string[];
} {
  const store = new Map<string, { value: unknown; expiresAt: number; options?: TeamPerfCacheOptions }>();
  const gets: string[] = [];
  return {
    gets,
    get store() {
      const view = new Map<string, { value: unknown; options?: TeamPerfCacheOptions }>();
      for (const [key, entry] of store) view.set(key, { value: entry.value, options: entry.options });
      return view;
    },
    async get(key) {
      gets.push(key);
      const hit = store.get(key);
      if (!hit) return null;
      if (hit.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      return hit.value;
    },
    async set(key, value, options) {
      store.set(key, { value, expiresAt: Date.now() + (options?.ttl ?? 60) * 1000, options });
    },
  };
}

function inWindow(value: unknown, from: Date | null, to: Date | null): boolean {
  const raw = value ? new Date(value as string | number | Date).getTime() : NaN;
  if (from == null && to == null) return true;
  if (Number.isNaN(raw)) return false;
  if (from && raw < from.getTime()) return false;
  if (to && raw >= to.getTime()) return false;
  return true;
}

async function run<C extends TeamPerfCache = ReturnType<typeof createCache>>(options: {
  role?: string;
  range?: string | null;
  tz?: string | null;
  authorization?: string | null;
  flags?: Record<string, unknown>;
  leads?: LeadDoc[];
  users?: UserDoc[];
  now?: Date;
  auth?: Partial<RequireApprovedUserDeps>;
  onLeads?: (from: Date | null, to: Date | null) => void;
  onUsers?: () => void;
  filterLeads?: boolean;
  cache?: C;
}): Promise<{
  result: Awaited<ReturnType<typeof handleTeamPerformance>>;
  leadCalls: Array<{ from: Date | null; to: Date | null }>;
  userCalls: number;
  cache: C;
}> {
  const leadCalls: Array<{ from: Date | null; to: Date | null }> = [];
  let userCalls = 0;
  const cache = (options.cache ?? createCache()) as C;
  const leads = options.leads ?? [];
  const deps: TeamPerfDeps = {
    ...authDeps(options.role ?? 'manager', options.flags),
    ...options.auth,
    now: () => options.now ?? NOW,
    cache,
    loadUsers: async () => {
      userCalls += 1;
      options.onUsers?.();
      return options.users ?? [];
    },
    loadLeads: async (from, to) => {
      leadCalls.push({ from, to });
      options.onLeads?.(from, to);
      if (options.filterLeads === false) return leads;
      return leads.filter((lead) => inWindow(lead.data.dispositionedAt, from, to));
    },
  };
  const result = await handleTeamPerformance({
    authorization: options.authorization === undefined ? 'Bearer token' : options.authorization,
    rangeParam: options.range === undefined ? 'today' : options.range,
    tzParam: options.tz === undefined ? 'America/New_York' : options.tz,
    deps,
  });
  return { result, leadCalls, userCalls, cache };
}

function assertNoLeadPii(body: unknown) {
  const keys = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        keys.add(key);
        walk(child);
      }
    }
  };
  walk(body);
  for (const key of PII_KEYS) assert.equal(keys.has(key), false, key);
  const serialized = JSON.stringify(body);
  for (const secret of ['SECRET-ADDRESS', 'SECRET-NAME', '555-0100', 'hidden@example.com', 'private note']) {
    assert.equal(serialized.includes(secret), false, secret);
  }
}

describe('team performance route access', () => {
  it('returns 401 when there is no token and does not touch the cache or leads', async () => {
    const order: string[] = [];
    const { result, leadCalls } = await run({
      authorization: null,
      cache: {
        get: async () => {
          order.push('cache');
          return null;
        },
        set: async () => {
          order.push('cache');
        },
      },
      onLeads: () => order.push('leads'),
      auth: {
        verifyIdToken: async () => {
          order.push('auth');
          return { uid: 'uid' };
        },
      },
    });
    assert.equal(result.status, 401);
    assert.equal(leadCalls.length, 0);
    assert.deepEqual(order, []);
    assert.equal('setters' in result.body, false);
  });

  it('returns 403 for setter, closer, and pending before reading the cache', async () => {
    for (const role of ['setter', 'closer']) {
      const order: string[] = [];
      const { result, leadCalls } = await run({
        role,
        cache: {
          get: async () => {
            order.push('cache');
            return { source: 'live', setters: [], totals: {}, docsRead: 1 };
          },
          set: async () => {
            order.push('cache');
          },
        },
        onLeads: () => order.push('leads'),
      });
      assert.equal(result.status, 403, role);
      assert.equal(leadCalls.length, 0);
      assert.deepEqual(order, []);
    }

    const pending = await run({
      role: 'manager',
      flags: { approvalStatus: 'pending' },
      onLeads: () => {
        throw new Error('loadLeads should not run');
      },
    });
    assert.equal(pending.result.status, 403);
    assert.equal(pending.leadCalls.length, 0);
    assert.equal(pending.cache.gets.length, 0);
  });

  it('checks auth before the cache on an allowed request', async () => {
    const order: string[] = [];
    const { result } = await run({
      role: 'manager',
      auth: {
        verifyIdToken: async () => {
          order.push('auth');
          return { uid: 'uid-manager' };
        },
        getUser: async () => {
          order.push('user');
          return { exists: true, data: { role: 'manager', approved: true, isActive: true } };
        },
      },
      cache: {
        get: async () => {
          order.push('cache');
          return null;
        },
        set: async () => {
          order.push('cache-set');
        },
      },
      onUsers: () => order.push('users'),
      onLeads: () => order.push('leads'),
    });
    assert.equal(result.status, 200);
    assert.ok(order.indexOf('auth') < order.indexOf('cache'));
    assert.ok(order.indexOf('user') < order.indexOf('cache'));
    assert.ok(order.indexOf('cache') < order.indexOf('leads'));
  });
});

describe('team performance windows', () => {
  it('clamps manager range=all to 62 days and leaves admin range=all unbounded', async () => {
    const manager = await run({ role: 'manager', range: 'all', tz: 'America/New_York' });
    assert.equal(manager.result.status, 200);
    assert.equal(manager.leadCalls.length, 1);
    assert.equal(manager.leadCalls[0].from?.getTime(), NOW.getTime() - STATS_WINDOW_MS);
    assert.equal(manager.leadCalls[0].to, null);
    assert.ok('from' in manager.result.body);
    if ('from' in manager.result.body) {
      assert.equal(manager.result.body.from, new Date(NOW.getTime() - STATS_WINDOW_MS).toISOString());
      assert.equal(manager.result.body.to, null);
      assert.equal(manager.result.body.staleAfterSec, 60);
    }

    const admin = await run({ role: 'admin', range: 'all', tz: 'America/New_York' });
    assert.equal(admin.result.status, 200);
    assert.deepEqual(admin.leadCalls, [{ from: null, to: null }]);
    assert.ok('from' in admin.result.body);
    if ('from' in admin.result.body) {
      assert.equal(admin.result.body.from, null);
      assert.equal(admin.result.body.to, null);
    }
    const adminKey = [...admin.cache.store.keys()].find((key) => key.startsWith('team-perf:v1:'));
    assert.equal(adminKey, teamPerfCacheKey({
      range: 'all',
      tz: 'America/New_York',
      from: null,
      to: null,
      scope: 'admin-all',
    }));
    assert.equal(adminKey?.endsWith(':open:open:admin-all'), true);
  });

  it('returns 400 for a bad range or time zone and does not read leads', async () => {
    for (const args of [
      { range: 'fortnight', tz: 'America/New_York' },
      { range: '', tz: 'America/New_York' },
      { range: 'today', tz: 'Not/AZone' },
    ]) {
      const { result, leadCalls, cache } = await run(args);
      assert.equal(result.status, 400);
      assert.equal(leadCalls.length, 0);
      assert.equal(cache.gets.length, 0);
    }
  });

  it('uses a bounded window for every range except admin all', async () => {
    const floor = NOW.getTime() - STATS_WINDOW_MS;
    for (const range of TIME_RANGES) {
      for (const role of ['manager', 'admin'] as const) {
        const { result, leadCalls } = await run({ role, range, tz: 'America/Phoenix' });
        assert.equal(result.status, 200, `${role} ${range}`);
        assert.equal(leadCalls.length, 1);
        if (role === 'admin' && range === 'all') {
          assert.equal(leadCalls[0].from, null);
          assert.equal(leadCalls[0].to, null);
          continue;
        }
        assert.ok(leadCalls[0].from instanceof Date, `${role} ${range} from`);
        if (role !== 'admin') assert.ok(leadCalls[0].from!.getTime() >= floor);
        if (range === 'yesterday' || range === 'lastmonth') assert.ok(leadCalls[0].to instanceof Date);
        else assert.equal(leadCalls[0].to, null);
      }
    }
  });
});

describe('team performance cache and response', () => {
  const richLead: LeadDoc = {
    id: 'lead-secret-id',
    data: {
      name: 'SECRET-NAME',
      address: 'SECRET-ADDRESS',
      phone: '555-0100',
      email: 'hidden@example.com',
      notes: 'private note',
      lat: 33.4,
      lng: -112.1,
      status: 'appointment',
      dispositionedAt: '2026-10-17T14:00:00.000Z',
      claimedBy: 'setter-a',
      assignedTo: 'setter-b',
      goBackScheduledBy: 'setter-a',
      dispositionHistory: [{ userId: 'setter-a', userName: 'SECRET-NAME', notes: 'private note' }],
    },
  };

  it('returns aggregated setters with no lead id, address, or name', async () => {
    const { result } = await run({
      role: 'admin',
      range: 'today',
      leads: [richLead],
      users: [{ id: 'setter-a', data: { team: 'Buffalo' } }],
      filterLeads: true,
    });
    assert.equal(result.status, 200);
    assert.ok('setters' in result.body);
    const body = result.body as TeamPerfResponse;
    assert.equal(body.source, 'live');
    assert.equal(body.range, 'today');
    assert.equal(body.tz, 'America/New_York');
    assert.deepEqual(Object.keys(body).sort(), [
      'docsRead',
      'from',
      'generatedAt',
      'range',
      'setters',
      'source',
      'staleAfterSec',
      'to',
      'totals',
      'tz',
    ]);
    assert.equal(body.setters.length, 1);
    assert.deepEqual(Object.keys(body.setters[0]).sort(), [...SETTER_KEYS].sort());
    assert.equal(body.setters[0].userId, 'setter-a');
    assert.equal(body.setters[0].knocks, 1);
    assert.equal(body.setters[0].appointments, 1);
    assert.equal(body.setters[0].goBacksScheduled, 1);
    assert.equal(body.setters[0].goBacksConverted, 1);
    assert.equal(body.totals.knocks, 1);
    assert.deepEqual(Object.keys(body.totals).sort(), [...COUNTER_KEYS].sort());
    assertNoLeadPii(body);
    assert.equal(JSON.stringify(body).includes('lead-secret-id'), false);
  });

  it('serves a cache hit without calling loadLeads and checks auth first', async () => {
    const cache = createCache();
    const first = await run({
      role: 'manager',
      range: 'today',
      tz: 'America/New_York',
      cache,
      leads: [richLead],
      users: [
        { id: 'setter-a', data: { team: 'Buffalo' } },
        { id: 'setter-test', data: { team: 'TEST' } },
      ],
    });
    assert.equal(first.leadCalls.length, 1);
    assert.equal(first.userCalls, 1);
    const todayEntry = [...cache.store.entries()].find(([key]) => key.includes(':today:'));
    assert.ok(todayEntry);
    assert.equal(todayEntry[1].options?.ttl, 60);
    assert.deepEqual(todayEntry[1].options?.tags, ['team-perf', 'team-perf:2026-10-17']);

    const second = await run({
      role: 'admin',
      range: 'today',
      tz: 'America/New_York',
      cache,
      leads: [richLead],
      users: [{ id: 'setter-a', data: { team: 'Buffalo' } }],
    });
    assert.equal(second.result.status, 200);
    assert.equal(second.leadCalls.length, 0);
    assert.equal(second.userCalls, 0);
    assert.deepEqual((second.result.body as TeamPerfResponse).setters, (first.result.body as TeamPerfResponse).setters);

    const denied = await run({
      role: 'setter',
      range: 'today',
      tz: 'America/New_York',
      cache,
      leads: [richLead],
    });
    assert.equal(denied.result.status, 403);
    assert.equal(denied.leadCalls.length, 0);
    assert.equal('setters' in denied.result.body, false);
  });

  it('caches a closed range for 10 minutes and truncates the rolling key to the minute', async () => {
    const now = new Date('2026-10-17T15:00:30.500Z');
    const cache = createCache();
    const closed = await run({ role: 'manager', range: 'yesterday', tz: 'UTC', now, cache });
    const yesterday = [...cache.store.entries()].find(([key]) => key.includes(':yesterday:'));
    assert.ok(yesterday);
    assert.equal(yesterday[1].options?.ttl, 600);
    assert.equal((closed.result.body as TeamPerfResponse).staleAfterSec, 600);

    const rolling = await run({ role: 'admin', range: 'last7days', tz: 'UTC', now, cache });
    assert.equal(rolling.result.status, 200);
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const key = teamPerfCacheKey({ range: 'last7days', tz: 'UTC', from, to: null, scope: 'scoped' });
    assert.equal(key.includes('2026-10-10T15:00:00.000Z'), true);
    assert.equal(key.includes('15:00:30'), false);
    assert.ok(cache.store.has(key));
    assert.equal((rolling.result.body as TeamPerfResponse).from, from.toISOString());
  });

  it('does not let a test user row through', async () => {
    const { result } = await run({
      role: 'manager',
      range: 'all',
      leads: [
        {
          id: 'lead-real',
          data: {
            status: 'not-home',
            dispositionedAt: NOW.toISOString(),
            claimedBy: 'setter-test',
            address: 'SECRET-ADDRESS',
          },
        },
        {
          id: 'lead-kept',
          data: {
            status: 'interested',
            dispositionedAt: NOW.toISOString(),
            claimedBy: 'setter-b',
            name: 'SECRET-NAME',
          },
        },
      ],
      users: [
        { id: 'setter-test', data: { team: 'TEST' } },
        { id: 'setter-b', data: { team: 'Testing' } },
      ],
    });
    const body = result.body as TeamPerfResponse;
    assert.deepEqual(body.setters.map((setter) => setter.userId), ['setter-b']);
    assert.equal(body.totals.knocks, 1);
    assert.equal(body.totals.conversations, 1);
    assertNoLeadPii(body);
  });
});

describe('team performance read count', () => {
  it('reads only today when 900 leads are today and 27k are older', async () => {
    const todayStart = new Date('2026-10-17T04:00:00.000Z');
    const todayStamp = new Date('2026-10-17T14:00:00.000Z');
    const olderStamp = new Date('2026-10-16T14:00:00.000Z');
    const users: UserDoc[] = [
      { id: 'setter-a', data: { team: 'Buffalo' } },
      { id: 'setter-b', data: { team: 'Testing' } },
    ];
    const leadCalls: Array<{ from: Date | null; to: Date | null }> = [];
    let userCalls = 0;
    const deps: TeamPerfDeps = {
      ...authDeps('manager'),
      now: () => NOW,
      cache: createCache(),
      loadUsers: async () => {
        userCalls += 1;
        return users;
      },
      loadLeads: async (from, to) => {
        leadCalls.push({ from, to });
        const todayIn = inWindow(todayStamp.toISOString(), from, to);
        const olderIn = inWindow(olderStamp.toISOString(), from, to);
        const count = (todayIn ? 900 : 0) + (olderIn ? 27_000 : 0);
        return Array.from({ length: count }, (_, index) => ({
          id: `lead-${index}`,
          data: {
            status: 'not-home',
            dispositionedAt: (todayIn && index < 900 ? todayStamp : olderStamp).toISOString(),
            claimedBy: 'setter-a',
            address: 'SECRET-ADDRESS',
            name: 'SECRET-NAME',
          },
        }));
      },
    };
    const live = await handleTeamPerformance({
      authorization: 'Bearer token',
      rangeParam: 'today',
      tzParam: 'America/New_York',
      deps,
    });
    assert.equal(live.status, 200);
    assert.equal(leadCalls.length, 1);
    assert.equal(leadCalls[0].from?.toISOString(), todayStart.toISOString());
    assert.equal(leadCalls[0].to, null);
    assert.ok(leadCalls[0].from!.getTime() > olderStamp.getTime());
    const body = live.body as TeamPerfResponse;
    assert.ok(body.docsRead <= 900 + users.length);
    assert.equal(body.docsRead, 900 + userCalls * users.length);
    assert.equal(body.totals.knocks, 900);
    assert.equal(JSON.stringify(body).includes('SECRET-ADDRESS'), false);
    assert.equal(JSON.stringify(body).includes('lead-0'), false);
  });
});

describe('buildTeamPerfLeadQuery', () => {
  it('selects the stats fields and applies an inclusive start and exclusive end', () => {
    const calls: unknown[][] = [];
    const query = {
      where(field: string, op: string, value: unknown) {
        calls.push(['where', field, op, value]);
        return query;
      },
      select(...fields: string[]) {
        calls.push(['select', ...fields]);
        return query;
      },
    };
    const from = new Date('2026-10-17T04:00:00.000Z');
    const to = new Date('2026-10-18T04:00:00.000Z');
    buildTeamPerfLeadQuery(query, from, to);
    assert.deepEqual(calls, [
      ['where', 'dispositionedAt', '>=', from],
      ['where', 'dispositionedAt', '<', to],
      ['select', ...STATS_SELECT_FIELDS],
    ]);
    calls.length = 0;
    buildTeamPerfLeadQuery(query, null, null);
    assert.deepEqual(calls, [['select', ...STATS_SELECT_FIELDS]]);
  });
});

/**
 * Oracle copied from calculateSetterMetrics() in app/setter-stats/page.tsx.
 * Names are irrelevant to the counters. The time-window switch is unchanged.
 */
function calculateSetterMetrics(
  leads: Array<{
    dispositionedAt?: unknown;
    dispositionHistory?: { userId?: string }[];
    claimedBy?: unknown;
    assignedTo?: unknown;
    status?: unknown;
    goBackScheduledBy?: unknown;
  }>,
  users: Array<{ id: string; name?: string }>,
  timeFilter: TimeRange,
) {
  const setterMap = new Map<string, { userId: string; userName: string } & Counters>();

  let cutoffDate: Date;
  let endDate: Date | undefined;

  switch (timeFilter) {
    case 'today':
      cutoffDate = startOfToday();
      endDate = undefined;
      break;
    case 'yesterday':
      cutoffDate = new Date(startOfToday().getTime() - 86400000);
      endDate = startOfToday();
      break;
    case 'last7days':
      cutoffDate = new Date(Date.now() - 7 * 86400000);
      break;
    case 'thisweek':
      cutoffDate = startOfWeek(new Date());
      break;
    case 'lastweek':
      cutoffDate = new Date(startOfWeek(new Date()).getTime() - 7 * 86400000);
      break;
    case 'thismonth':
      cutoffDate = startOfMonth(new Date());
      break;
    case 'lastmonth': {
      const thisMonth = startOfMonth(new Date());
      cutoffDate = startOfMonth(new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 1, 1));
      endDate = thisMonth;
      break;
    }
    default:
      cutoffDate = new Date(0);
      endDate = undefined;
  }

  const filteredLeads = leads.filter(lead => {
    if (!lead.dispositionedAt) return false;
    const leadDate = new Date(lead.dispositionedAt as string);
    if (!isAfter(leadDate, cutoffDate)) return false;
    if (endDate && !isAfter(endDate, leadDate)) return false;
    return true;
  });

  filteredLeads.forEach(lead => {
    const userId = lead.dispositionHistory?.[0]?.userId || lead.claimedBy || lead.assignedTo;
    if (!userId || typeof userId !== 'string') return;

    if (!setterMap.has(userId)) {
      const user = users.find(u => u.id === userId);
      setterMap.set(userId, {
        userId,
        userName: user?.name || 'Unknown',
        knocks: 0,
        conversations: 0,
        appointments: 0,
        sales: 0,
        notHome: 0,
        notInterested: 0,
        goBacksScheduled: 0,
        goBacksConverted: 0,
      });
    }

    const metrics = setterMap.get(userId)!;

    metrics.knocks++;

    switch (lead.status) {
      case 'not-home':
        metrics.notHome++;
        break;
      case 'not-interested':
        metrics.notInterested++;
        metrics.conversations++;
        break;
      case 'interested':
        metrics.conversations++;
        break;
      case 'appointment':
        metrics.appointments++;
        metrics.conversations++;
        break;
      case 'sale':
        metrics.sales++;
        metrics.appointments++;
        metrics.conversations++;
        break;
    }

    if (lead.goBackScheduledBy === userId) {
      metrics.goBacksScheduled++;
      if (lead.status === 'appointment' || lead.status === 'sale') {
        metrics.goBacksConverted++;
      }
    }
  });

  return Array.from(setterMap.values());
}

function withFrozenDate<T>(now: Date, fn: () => T): T {
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args: Array<number | string | Date>) {
      if (args.length === 0) super(now.getTime());
      else super(...(args as ConstructorParameters<typeof RealDate>));
    }

    static now() {
      return now.getTime();
    }
  }
  FrozenDate.parse = RealDate.parse;
  FrozenDate.UTC = RealDate.UTC;
  globalThis.Date = FrozenDate as DateConstructor;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

function pickCounters(row: { userId: string } & Partial<Counters>): Counters {
  const counters = {} as Counters;
  for (const key of COUNTER_KEYS) counters[key] = row[key] ?? 0;
  return counters;
}

describe('team performance parity with the current page', () => {
  const parityNow = new Date('2026-10-17T15:00:00.000Z');
  const parityTz = 'UTC';
  const statuses = ['not-home', 'not-interested', 'interested', 'appointment', 'sale', 'go-back'] as const;
  const realUsers = ['setter-a', 'setter-b', 'setter-c'];
  const users: UserDoc[] = [
    { id: 'setter-a', data: { team: 'Buffalo', name: 'Ada' } },
    { id: 'setter-b', data: { team: 'Testing', name: 'Bea' } },
    { id: 'setter-c', data: { team: 'Rochester', name: 'Cam' } },
    { id: 'setter-test', data: { team: 'TEST', name: 'Should Hide' } },
    { id: 'TEST-reviewer', data: { team: 'Buffalo', name: 'Reviewer' } },
    { id: 'setter-flag', data: { team: 'Buffalo', isTestAccount: 'yes', name: 'Flagged' } },
  ];

  const leads: LeadDoc[] = [];
  for (let i = 0; i < 240; i++) {
    const dayOffset = i % 70;
    const hourOffset = i % 20;
    const dispositionedAt = new Date(
      parityNow.getTime() - dayOffset * 86400000 - hourOffset * 3600000 - 30 * 60 * 1000,
    ).toISOString();
    let userId = realUsers[i % 3];
    if (i % 17 === 0) userId = 'setter-test';
    else if (i % 29 === 0) userId = 'TEST-reviewer';
    else if (i % 31 === 0) userId = 'setter-flag';
    const data: Record<string, unknown> = {
      status: statuses[i % statuses.length],
      dispositionedAt,
      name: `SECRET-NAME-${i}`,
      address: `SECRET-ADDRESS-${i}`,
      phone: '555-0100',
      notes: 'private note',
    };
    if (i % 23 === 0) data.testData = true;
    if (i % 5 === 0) {
      data.dispositionHistory = [{ userId, notes: 'history note', userName: 'SECRET-NAME' }];
      data.claimedBy = 'setter-a';
      data.assignedTo = 'setter-c';
    } else if (i % 5 === 1) {
      data.claimedBy = userId;
      data.assignedTo = 'setter-c';
    } else if (i % 5 === 2) {
      data.assignedTo = userId;
    } else if (i % 5 === 3) {
      data.dispositionHistory = [{ userId: 'setter-a', notes: 'override' }];
      data.claimedBy = userId;
      data.assignedTo = 'setter-c';
    } else {
      data.dispositionHistory = [{ userId }];
      data.claimedBy = userId;
    }
    if (i % 4 === 0) data.goBackScheduledBy = userId;
    else if (i % 4 === 1) data.goBackScheduledBy = 'someone-else';
    leads.push({ id: i % 19 === 0 ? `TEST-appreview-${i}` : `lead-${i}`, data });
  }
  leads.push({
    id: 'lead-no-user',
    data: { status: 'sale', dispositionedAt: parityNow.toISOString(), address: 'SECRET-ADDRESS-nouser' },
  });
  leads.push({
    id: 'lead-no-date',
    data: { status: 'sale', claimedBy: 'setter-a', address: 'SECRET-ADDRESS-nodate' },
  });
  leads.push({
    id: 'lead-nested-test',
    data: {
      status: 'sale',
      dispositionedAt: parityNow.toISOString(),
      claimedBy: 'setter-a',
      meta: { testData: 'yes' },
      address: 'SECRET-ADDRESS-nested',
    },
  });

  assert.ok(leads.length >= 200);

  const excludedUsers = new Set(users.filter((user) => isExcludedTestUser(user.id, user.data)).map((user) => user.id));

  for (const range of TIME_RANGES) {
    for (const role of ['manager', 'admin'] as const) {
      it(`matches page counters for ${role} ${range}`, async () => {
        const endpoint = await run({
          role,
          range,
          tz: parityTz,
          now: parityNow,
          leads,
          users,
        });
        assert.equal(endpoint.result.status, 200);
        const body = endpoint.result.body as TeamPerfResponse;

        const v1 = await handleAllLeadsStats({
          authorization: 'Bearer token',
          sinceParam: role === 'admin' ? 'all' : null,
          deps: {
            ...authDeps(role),
            now: () => parityNow,
            loadLeads: async (bound) => leads.filter((lead) => inWindow(lead.data.dispositionedAt, bound, null)),
          },
        });
        assert.equal(v1.status, 200);
        if (!('leads' in v1.body)) throw new Error('v1 stats response missing leads');
        const v1Leads = v1.body.leads;

        const oracle = withFrozenDate(parityNow, () =>
          calculateSetterMetrics(v1Leads, users.map((user) => ({
            id: user.id,
            name: typeof user.data.name === 'string' ? user.data.name : undefined,
          })), range).filter((metric) => !excludedUsers.has(metric.userId)),
        );

        const endpointByUser = Object.fromEntries(body.setters.map((setter) => [setter.userId, pickCounters(setter)]));
        const oracleByUser = Object.fromEntries(oracle.map((setter) => [setter.userId, pickCounters(setter)]));
        assert.deepEqual(endpointByUser, oracleByUser);

        const oracleTotals = oracle.reduce((acc, setter) => {
          for (const key of COUNTER_KEYS) acc[key] += setter[key];
          return acc;
        }, {
          knocks: 0,
          conversations: 0,
          appointments: 0,
          sales: 0,
          notHome: 0,
          notInterested: 0,
          goBacksScheduled: 0,
          goBacksConverted: 0,
        } satisfies Counters);
        assert.deepEqual(body.totals, oracleTotals);
        assert.equal(body.setters.some((setter) => excludedUsers.has(setter.userId)), false);
        assertNoLeadPii(body);
        if (role === 'admin' && range === 'all') {
          assert.ok(body.setters.some((setter) => setter.userId === 'setter-b'));
          assert.equal(body.setters.some((setter) => setter.userId === 'setter-test'), false);
        }
      });
    }
  }
});
