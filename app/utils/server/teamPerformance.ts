import {
  aggregate,
  etDateStamp,
  isExcludedTestUser,
  resolveRange,
  type TeamStatsSetter,
  type TimeRange,
  type Counters,
} from '../teamStats/aggregate';
import { STATS_SELECT_FIELDS, defaultStatsSince } from './allLeadsStats';
import {
  HttpError,
  requireApprovedUser,
  type RequireApprovedUserDeps,
} from './requireApprovedUser';
import { getTeamPerfCache, type TeamPerfCache, type TeamPerfCacheOptions } from './teamPerfCache';

const TEAM_STATS_ROLES = new Set(['manager', 'admin']);
const USERS_CACHE_KEY = 'team-perf:users:v1';
const USERS_CACHE_TTL_SEC = 10 * 60;

export type TeamPerfResponse = {
  range: TimeRange;
  tz: string;
  from: string | null;
  to: string | null;
  source: 'live';
  generatedAt: string;
  staleAfterSec: number;
  setters: TeamStatsSetter[];
  totals: Counters;
  docsRead: number;
};

export type TeamPerfDeps = RequireApprovedUserDeps & {
  loadLeads: (
    from: Date | null,
    to: Date | null,
  ) => Promise<Array<{ id: string; data: Record<string, unknown> }>>;
  loadUsers: () => Promise<Array<{ id: string; data: Record<string, unknown> }>>;
  now?: () => Date;
  cache?: TeamPerfCache;
};

function logToken(value: string | null | undefined): string {
  const token = (value ?? '').trim().replace(/\s+/g, '_');
  return token ? token.slice(0, 80) : '-';
}

function minuteIso(date: Date): string {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000).toISOString();
}

export function teamPerfCacheKey(input: {
  range: string;
  tz: string;
  from: Date | null;
  to: Date | null;
  scope: 'admin-all' | 'scoped';
}): string {
  return [
    'team-perf:v1',
    input.range,
    input.tz,
    input.from ? minuteIso(input.from) : 'open',
    input.to ? minuteIso(input.to) : 'open',
    input.scope,
  ].join(':');
}

function isTeamPerfResponse(value: unknown): value is TeamPerfResponse {
  if (!value || typeof value !== 'object') return false;
  const body = value as Partial<TeamPerfResponse>;
  return Array.isArray(body.setters) && !!body.totals && typeof body.docsRead === 'number' && body.source === 'live';
}

async function readCache(cache: TeamPerfCache, key: string): Promise<unknown | null> {
  try {
    const value = await cache.get(key);
    if (value == null) return null;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return null;
      }
    }
    return value;
  } catch {
    return null;
  }
}

async function writeCache(cache: TeamPerfCache, key: string, value: unknown, options: TeamPerfCacheOptions): Promise<void> {
  try {
    await cache.set(key, value, options);
  } catch {
    // A cache write failure still returns the live aggregate.
  }
}

async function excludedUserIds(
  cache: TeamPerfCache,
  loadUsers: TeamPerfDeps['loadUsers'],
): Promise<{ ids: Set<string>; docsRead: number }> {
  const cached = await readCache(cache, USERS_CACHE_KEY);
  if (Array.isArray(cached) && cached.every((id) => typeof id === 'string')) {
    return { ids: new Set(cached), docsRead: 0 };
  }

  const users = await loadUsers();
  const ids = users.filter((user) => isExcludedTestUser(user.id, user.data)).map((user) => user.id);
  await writeCache(cache, USERS_CACHE_KEY, ids, { ttl: USERS_CACHE_TTL_SEC, tags: ['team-perf-users'] });
  return { ids: new Set(ids), docsRead: users.length };
}

// Firestore's CollectionReference/Query fluent types disagree with a narrow
// structural where/select pair, so the live collection is passed through as any.
export function buildTeamPerfLeadQuery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leadsCollection: any,
  from: Date | null,
  to: Date | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  let query = leadsCollection;
  if (from) query = query.where('dispositionedAt', '>=', from);
  if (to) query = query.where('dispositionedAt', '<', to);
  return query.select(...STATS_SELECT_FIELDS);
}

export async function handleTeamPerformance(input: {
  authorization: string | null;
  rangeParam: string | null;
  tzParam: string | null;
  deps: TeamPerfDeps;
}): Promise<{ status: number; body: { error: string } | TeamPerfResponse }> {
  const started = Date.now();
  const logged = {
    role: 'unknown',
    range: logToken(input.rangeParam),
    tz: logToken(input.tzParam),
    docsRead: 0,
    cacheHit: false,
  };

  const finish = (status: number, body: { error: string } | TeamPerfResponse) => {
    console.log(
      `[team-perf] ${logged.role} ${logged.range} ${logged.tz} ${logged.docsRead} ${logged.cacheHit} ${Date.now() - started}`,
    );
    return { status, body };
  };

  try {
    let approved;
    try {
      approved = await requireApprovedUser(input.authorization, input.deps);
    } catch (error) {
      if (error instanceof HttpError) return finish(error.status, { error: error.message });
      throw error;
    }

    logged.role = approved.role || 'unknown';
    if (!TEAM_STATS_ROLES.has(approved.role)) {
      return finish(403, { error: 'Team stats are limited to managers and admins.' });
    }

    const now = input.deps.now?.() ?? new Date();
    const resolved = resolveRange(input.rangeParam, input.tzParam, now);
    if (!resolved.ok) return finish(400, { error: resolved.error });
    logged.range = resolved.range;
    logged.tz = resolved.tz;

    let from = resolved.from;
    const to = resolved.to;
    // Same 62-day floor as v1. Non-admins are clamped, never rejected.
    if (approved.role !== 'admin') {
      const floor = defaultStatsSince(now);
      if (from == null || from.getTime() < floor.getTime()) from = floor;
    }

    const scope = approved.role === 'admin' && resolved.range === 'all' ? 'admin-all' : 'scoped';
    const key = teamPerfCacheKey({ range: resolved.range, tz: resolved.tz, from, to, scope });
    const cache = input.deps.cache ?? getTeamPerfCache();

    const cached = await readCache(cache, key);
    if (isTeamPerfResponse(cached)) {
      logged.cacheHit = true;
      logged.docsRead = 0;
      return finish(200, cached);
    }

    const users = await excludedUserIds(cache, input.deps.loadUsers);
    const leads = await input.deps.loadLeads(from, to);
    logged.docsRead = leads.length + users.docsRead;

    const { setters, totals } = aggregate(leads, users.ids);
    const staleAfterSec = to == null ? 60 : 600;
    const body: TeamPerfResponse = {
      range: resolved.range,
      tz: resolved.tz,
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
      source: 'live',
      generatedAt: now.toISOString(),
      staleAfterSec,
      setters,
      totals,
      docsRead: logged.docsRead,
    };

    await writeCache(cache, key, body, {
      ttl: staleAfterSec,
      tags: ['team-perf', `team-perf:${etDateStamp(now)}`],
    });
    return finish(200, body);
  } catch (error) {
    console.error('[team-perf] error:', error);
    return finish(503, { error: 'Team stats are temporarily unavailable.' });
  }
}
