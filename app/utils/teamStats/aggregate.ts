/**
 * Pure Team Performance aggregation. No Firestore imports.
 * Phase 2 bucket maintenance should call this same module.
 */

export const DEFAULT_TEAM_STATS_TZ = 'America/New_York';

export const TIME_RANGES = [
  'today',
  'yesterday',
  'last7days',
  'thisweek',
  'lastweek',
  'thismonth',
  'lastmonth',
  'all',
] as const;

export type TimeRange = (typeof TIME_RANGES)[number];

export type Counters = {
  knocks: number;
  conversations: number;
  appointments: number;
  sales: number;
  notHome: number;
  notInterested: number;
  goBacksScheduled: number;
  goBacksConverted: number;
};

export type TeamStatsSetter = { userId: string } & Counters;

export type Contribution = {
  userId: string;
  counters: Counters;
};

export type ResolvedRange = {
  range: TimeRange;
  tz: string;
  from: Date | null;
  to: Date | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_FLAG_STRINGS = new Set(['true', '1', 'yes']);
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** true, "true", 1, "1", and "yes" (any case). false, 0, and null are not flags. */
function isTruthyTestFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  return TEST_FLAG_STRINGS.has(value.trim().toLowerCase());
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function recordHasTestFlag(value: unknown, seen: WeakSet<object>): boolean {
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    return value.some((item) => recordHasTestFlag(item, seen));
  }
  if (!isPlainRecord(value)) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'testData' || key === 'isTestAccount') && isTruthyTestFlag(child)) return true;
    if (recordHasTestFlag(child, seen)) return true;
  }
  return false;
}

/**
 * Test leads are dropped from stats. Matches a TEST- document id
 * (any case), a truthy testData flag at any depth, or a truthy isTestAccount.
 * Shared with GET /api/stats/all-leads.
 */
export function isExcludedTestLead(id: string, data: unknown): boolean {
  if (typeof id === 'string' && id.toLowerCase().startsWith('test-')) return true;
  return recordHasTestFlag(data, new WeakSet());
}

/**
 * Drop setter rows for test users. `team` must equal "TEST" exactly
 * (case-insensitive); "Testing" stays. A TEST- id or a truthy
 * isTestAccount/testData flag (nested allowed) is also excluded.
 */
export function isExcludedTestUser(id: string, user: unknown): boolean {
  if (typeof id === 'string' && id.toLowerCase().startsWith('test-')) return true;
  if (isPlainRecord(user)) {
    const team = user.team;
    if (typeof team === 'string' && team.trim().toLowerCase() === 'test') return true;
  }
  return recordHasTestFlag(user, new WeakSet());
}

export function emptyCounters(): Counters {
  return {
    knocks: 0,
    conversations: 0,
    appointments: 0,
    sales: 0,
    notHome: 0,
    notInterested: 0,
    goBacksScheduled: 0,
    goBacksConverted: 0,
  };
}

function addInto(target: Counters, extra: Counters): void {
  target.knocks += extra.knocks;
  target.conversations += extra.conversations;
  target.appointments += extra.appointments;
  target.sales += extra.sales;
  target.notHome += extra.notHome;
  target.notInterested += extra.notInterested;
  target.goBacksScheduled += extra.goBacksScheduled;
  target.goBacksConverted += extra.goBacksConverted;
}

function asUserId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value;
}

/** Latest disposition actor, then legacy claimedBy, then assignedTo. */
export function attributeLead(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  const history = Array.isArray(data.dispositionHistory) ? data.dispositionHistory : [];
  const first = history[0];
  let fromHistory: unknown;
  if (first && typeof first === 'object' && 'userId' in first) {
    fromHistory = (first as { userId?: unknown }).userId;
  }
  return asUserId(fromHistory || data.claimedBy || data.assignedTo || null);
}

function readDispositionedAt(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate === 'function') {
      try {
        const date = (toDate as () => Date).call(value);
        if (date instanceof Date && !Number.isNaN(date.getTime())) return date;
      } catch {
        return null;
      }
    }
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/**
 * One lead's counters for its attributed setter.
 * Mirrors calculateSetterMetrics() in app/setter-stats/page.tsx:
 * knocks for every dispositioned lead, then the status switch and go-back rules.
 * Returns null when the lead has no dispositionedAt, no attributed user, or is a test lead.
 */
export function contribution(id: string, data: Record<string, unknown> | null | undefined): Contribution | null {
  if (!data) return null;
  if (isExcludedTestLead(id, data)) return null;
  if (!readDispositionedAt(data.dispositionedAt)) return null;
  const userId = attributeLead(data);
  if (!userId) return null;

  const counters = emptyCounters();
  counters.knocks = 1;
  const status = data.status;
  switch (status) {
    case 'not-home':
      counters.notHome = 1;
      break;
    case 'not-interested':
      counters.notInterested = 1;
      counters.conversations = 1;
      break;
    case 'interested':
      counters.conversations = 1;
      break;
    case 'appointment':
      counters.appointments = 1;
      counters.conversations = 1;
      break;
    case 'sale':
      counters.sales = 1;
      counters.appointments = 1;
      counters.conversations = 1;
      break;
    default:
      break;
  }

  if (data.goBackScheduledBy === userId) {
    counters.goBacksScheduled = 1;
    if (status === 'appointment' || status === 'sale') counters.goBacksConverted = 1;
  }

  return { userId, counters };
}

export function aggregate(
  rows: Array<{ id: string; data: Record<string, unknown> }>,
  excludedUserIds?: ReadonlySet<string>,
): { setters: TeamStatsSetter[]; totals: Counters } {
  const byUser = new Map<string, Counters>();
  for (const row of rows) {
    const rowContribution = contribution(row.id, row.data);
    if (!rowContribution) continue;
    if (excludedUserIds?.has(rowContribution.userId)) continue;
    const current = byUser.get(rowContribution.userId) ?? emptyCounters();
    addInto(current, rowContribution.counters);
    byUser.set(rowContribution.userId, current);
  }

  const setters = [...byUser.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([userId, counters]) => ({ userId, ...counters }));

  const totals = emptyCounters();
  for (const setter of setters) addInto(totals, setter);
  return { setters, totals };
}

export function isTimeRange(value: string): value is TimeRange {
  return (TIME_RANGES as readonly string[]).includes(value);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
};

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  let year = Number(pick('year'));
  let month = Number(pick('month'));
  let day = Number(pick('day'));
  let hour = Number(pick('hour'));
  if (hour === 24) {
    hour = 0;
    const next = addCalendarDays(year, month, day, 1);
    year = next.year;
    month = next.month;
    day = next.day;
  }
  return {
    year,
    month,
    day,
    hour,
    minute: Number(pick('minute')),
    second: Number(pick('second')),
    weekday: pick('weekday'),
  };
}

function addCalendarDays(year: number, month: number, day: number, delta: number): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

/** Offset such that UTC + offset = wall clock interpreted as UTC. */
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

/** Wall-clock time in an IANA zone, as a UTC instant. Midnight is unambiguous across US DST. */
function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = wallAsUtc - timeZoneOffsetMs(new Date(wallAsUtc), timeZone);
  utc = wallAsUtc - timeZoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

function startOfZonedDay(now: Date, timeZone: string): Date {
  const parts = zonedParts(now, timeZone);
  return zonedWallTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
}

function startOfZonedMonth(now: Date, timeZone: string): Date {
  const parts = zonedParts(now, timeZone);
  return zonedWallTimeToUtc(parts.year, parts.month, 1, 0, 0, 0, timeZone);
}

function startOfPreviousZonedMonth(now: Date, timeZone: string): Date {
  const parts = zonedParts(now, timeZone);
  const year = parts.month === 1 ? parts.year - 1 : parts.year;
  const month = parts.month === 1 ? 12 : parts.month - 1;
  return zonedWallTimeToUtc(year, month, 1, 0, 0, 0, timeZone);
}

/** Sunday 00:00 in the zone. date-fns startOfWeek defaults to Sunday. */
function startOfZonedWeekSunday(now: Date, timeZone: string): Date {
  const parts = zonedParts(now, timeZone);
  const weekday = WEEKDAY_INDEX[parts.weekday];
  if (weekday == null) {
    throw new Error(`Unable to read weekday in ${timeZone}`);
  }
  const sunday = addCalendarDays(parts.year, parts.month, parts.day, -weekday);
  return zonedWallTimeToUtc(sunday.year, sunday.month, sunday.day, 0, 0, 0, timeZone);
}

/**
 * [from, to) using the Team Performance page's current rules, evaluated in `tz`.
 * yesterday is startOfToday minus 24h (not a calendar day), last7days is a rolling
 * 7 * 24h, and lastweek is startOfWeek minus 7 * 24h with no end (open through now).
 * `all` is unbounded. An empty tz defaults to America/New_York.
 */
export function resolveRange(
  rangeParam: string | null | undefined,
  tzParam: string | null | undefined,
  now: Date,
): ({ ok: true } & ResolvedRange) | { ok: false; error: string } {
  const range = (rangeParam ?? '').trim();
  if (!isTimeRange(range)) return { ok: false, error: 'Invalid range.' };

  const tzInput = (tzParam ?? '').trim();
  const tz = tzInput || DEFAULT_TEAM_STATS_TZ;
  if (!isValidTimeZone(tz)) return { ok: false, error: 'Invalid time zone.' };

  let from: Date | null = null;
  let to: Date | null = null;
  switch (range) {
    case 'today':
      from = startOfZonedDay(now, tz);
      break;
    case 'yesterday': {
      const startToday = startOfZonedDay(now, tz);
      from = new Date(startToday.getTime() - DAY_MS);
      to = startToday;
      break;
    }
    case 'last7days':
      from = new Date(now.getTime() - 7 * DAY_MS);
      break;
    case 'thisweek':
      from = startOfZonedWeekSunday(now, tz);
      break;
    case 'lastweek':
      from = new Date(startOfZonedWeekSunday(now, tz).getTime() - 7 * DAY_MS);
      break;
    case 'thismonth':
      from = startOfZonedMonth(now, tz);
      break;
    case 'lastmonth':
      from = startOfPreviousZonedMonth(now, tz);
      to = startOfZonedMonth(now, tz);
      break;
    case 'all':
      break;
    default:
      return { ok: false, error: 'Invalid range.' };
  }

  return { ok: true, range, tz, from, to };
}

/** America/New_York calendar date for cache tags. */
export function etDateStamp(now: Date): string {
  const parts = zonedParts(now, DEFAULT_TEAM_STATS_TZ);
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}
