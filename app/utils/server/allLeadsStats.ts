import {
  HttpError,
  requireApprovedUser,
  type RequireApprovedUserDeps,
} from './requireApprovedUser';

/**
 * Fields read from Firestore. id is the document id, not a stored field.
 * testData and isTestAccount are selected only so test leads can be dropped
 * in memory. They are not copied onto the response.
 */
export const STATS_SELECT_FIELDS = [
  'status',
  'dispositionedAt',
  'claimedBy',
  'assignedTo',
  'goBackScheduledBy',
  'dispositionHistory',
  'testData',
  'isTestAccount',
] as const;

export const STATS_WINDOW_MS = 62 * 24 * 60 * 60 * 1000;

const TEAM_STATS_ROLES = new Set(['manager', 'admin']);

export type StatsLead = {
  id: string;
  status: unknown;
  dispositionedAt: unknown;
  claimedBy: unknown;
  assignedTo: unknown;
  goBackScheduledBy: unknown;
  dispositionHistory: { userId: string }[];
};

export function defaultStatsSince(now: Date): Date {
  return new Date(now.getTime() - STATS_WINDOW_MS);
}

export function resolveStatsSince(
  sinceParam: string | null,
  role: string,
  now: Date,
): { ok: true; bound: Date | null } | { ok: false; status: number; error: string } {
  const floor = defaultStatsSince(now);
  if (sinceParam == null || sinceParam.trim() === '') {
    return { ok: true, bound: floor };
  }

  const since = sinceParam.trim();
  if (since === 'all') {
    if (role !== 'admin') {
      return { ok: false, status: 403, error: 'Only an admin can request every lead.' };
    }
    return { ok: true, bound: null };
  }

  const parsed = new Date(since);
  // Non-admins cannot widen the window. An earlier date is raised to the
  // 62-day floor, and a date that does not parse uses that same floor.
  if (role !== 'admin') {
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() < floor.getTime()) {
      return { ok: true, bound: floor };
    }
    return { ok: true, bound: parsed };
  }

  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, status: 400, error: 'Invalid since date.' };
  }
  return { ok: true, bound: parsed };
}

const TEST_FLAG_STRINGS = new Set(['true', '1', 'yes']);

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
 */
export function isExcludedTestLead(id: string, data: unknown): boolean {
  if (typeof id === 'string' && id.toLowerCase().startsWith('test-')) return true;
  return recordHasTestFlag(data, new WeakSet());
}

function serializeStatsValue(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate === 'function') {
      try {
        return (toDate as () => Date).call(value).toISOString();
      } catch {
        return null;
      }
    }
  }
  return value;
}

/**
 * Response allow-list. dispositionHistory is selected only so the first
 * entry's userId can be copied; every other history field is dropped.
 */
export function projectStatsLead(id: string, data: Record<string, unknown>): StatsLead {
  const history = Array.isArray(data.dispositionHistory) ? data.dispositionHistory : [];
  const first = history[0];
  let dispositionHistory: { userId: string }[] = [];
  if (first && typeof first === 'object') {
    const userId = 'userId' in first ? String((first as { userId?: unknown }).userId ?? '') : '';
    dispositionHistory = [{ userId }];
  }

  return {
    id,
    status: data.status ?? null,
    dispositionedAt: serializeStatsValue(data.dispositionedAt) ?? null,
    claimedBy: data.claimedBy ?? null,
    assignedTo: data.assignedTo ?? null,
    goBackScheduledBy: data.goBackScheduledBy ?? null,
    dispositionHistory,
  };
}

// Firestore's CollectionReference/Query fluent types disagree with a narrow
// structural where/select pair, so the live collection is passed through as any.
// The select list itself is the allow-list under test.
export function buildStatsLeadQuery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leadsCollection: any,
  bound: Date | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const ranged = bound
    ? leadsCollection.where('dispositionedAt', '>=', bound)
    : leadsCollection;
  return ranged.select(...STATS_SELECT_FIELDS);
}

export async function handleAllLeadsStats(input: {
  authorization: string | null;
  sinceParam: string | null;
  deps: RequireApprovedUserDeps & {
    loadLeads: (bound: Date | null) => Promise<Array<{ id: string; data: Record<string, unknown> }>>;
    now?: () => Date;
  };
}): Promise<{ status: number; body: { error: string } | { leads: StatsLead[] } }> {
  let approved;
  try {
    approved = await requireApprovedUser(input.authorization, input.deps);
  } catch (error) {
    if (error instanceof HttpError) {
      return { status: error.status, body: { error: error.message } };
    }
    throw error;
  }

  if (!TEAM_STATS_ROLES.has(approved.role)) {
    return { status: 403, body: { error: 'Team stats are limited to managers and admins.' } };
  }

  const since = resolveStatsSince(input.sinceParam, approved.role, input.deps.now?.() ?? new Date());
  if (!since.ok) return { status: since.status, body: { error: since.error } };

  const docs = await input.deps.loadLeads(since.bound);
  const leads = docs
    .filter((doc) => !isExcludedTestLead(doc.id, doc.data))
    .map((doc) => projectStatsLead(doc.id, doc.data));
  return { status: 200, body: { leads } };
}
