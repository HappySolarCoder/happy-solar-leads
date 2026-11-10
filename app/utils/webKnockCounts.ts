import type { Disposition } from '@/app/types/disposition';
import type { Lead } from '@/app/types';
import { collectKnockEvents, type KnockEvent } from '@/app/utils/knockCount';
import {
  phoenixDayWindow,
  phoenixDayWindowFromKey,
  phoenixMonthWindow,
  phoenixPreviousMonthWindow,
  phoenixWeekStartMs,
} from '@/app/utils/phoenixDay';

export type SetterTimeFilter =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'thisweek'
  | 'lastweek'
  | 'thismonth'
  | 'lastmonth'
  | 'all';

export type TeamMapTimeFilter = SetterTimeFilter;

export type RangeWindow = {
  startMs: number;
  endMs?: number;
  /** Rolling windows keep the old strict lower edge. Calendar days are inclusive. */
  exclusiveStart?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function setterStatsWindow(filter: SetterTimeFilter, now: Date): RangeWindow {
  const today = phoenixDayWindow(now);
  switch (filter) {
    case 'today':
      return { startMs: today.startMs, endMs: today.endMs };
    case 'yesterday': {
      const startMs = today.startMs - DAY_MS;
      return { startMs, endMs: today.startMs };
    }
    case 'last7days':
      return { startMs: now.getTime() - 7 * DAY_MS, exclusiveStart: true };
    case 'thisweek':
      return { startMs: phoenixWeekStartMs(now) };
    case 'lastweek':
      return { startMs: phoenixWeekStartMs(now) - 7 * DAY_MS };
    case 'thismonth':
      return { startMs: phoenixMonthWindow(now).startMs };
    case 'lastmonth': {
      const month = phoenixPreviousMonthWindow(now);
      return { startMs: month.startMs, endMs: month.endMs };
    }
    default:
      return { startMs: 0 };
  }
}

/**
 * Same Phoenix edges as setter stats, except lastmonth stays "30 days before
 * the Phoenix start of this month" with no upper bound.
 */
export function teamMapWindow(filter: TeamMapTimeFilter, now: Date): RangeWindow {
  if (filter === 'lastmonth') {
    return {
      startMs: phoenixMonthWindow(now).startMs - 30 * DAY_MS,
      exclusiveStart: true,
    };
  }
  return setterStatsWindow(filter, now);
}

export function instantInWindow(at: number, window: RangeWindow): boolean {
  if (window.exclusiveStart) {
    if (!(at > window.startMs)) return false;
  } else if (at < window.startMs) return false;
  if (window.endMs != null && at >= window.endMs) return false;
  return true;
}

export type KnockIndex = {
  leads: readonly Lead[];
  dispositions: readonly Disposition[];
  events: KnockEvent[];
  byUser: Map<string, KnockEvent[]>;
  leadsById: Map<string, Lead>;
};

let cachedIndex: KnockIndex | null = null;
let fieldEventLedger: readonly KnockEvent[] = [];

/**
 * Counts-only knocks (fieldKnockEvents) for the signed-in viewer's scope, set by
 * loadFieldKnockEventLedger. They join history through knockCount's `ledger`
 * option, deduped on the shared key leadId|userId|dispositionId|at, then the
 * 120 s collapse. Empty = exactly today's counts.
 */
export function setFieldKnockEventLedger(events: readonly KnockEvent[]): void {
  fieldEventLedger = events;
  cachedIndex = null;
}

/** One pass per leads array. Later reads for the same arrays do not rescan. */
export function knockIndex(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
): KnockIndex {
  if (cachedIndex && cachedIndex.leads === leads && cachedIndex.dispositions === dispositions) {
    return cachedIndex;
  }
  const events = collectKnockEvents(leads, dispositions, fieldEventLedger.length ? { ledger: fieldEventLedger } : {});
  const byUser = new Map<string, KnockEvent[]>();
  for (const event of events) {
    const list = byUser.get(event.userId);
    if (list) list.push(event);
    else byUser.set(event.userId, [event]);
  }
  const leadsById = new Map<string, Lead>();
  for (const lead of leads) {
    if (lead?.id && !leadsById.has(lead.id)) leadsById.set(lead.id, lead);
  }
  cachedIndex = { leads, dispositions, events, byUser, leadsById };
  return cachedIndex;
}

function countInWindow(events: readonly KnockEvent[] | undefined, window: RangeWindow): number {
  if (!events) return 0;
  let count = 0;
  for (const event of events) {
    if (instantInWindow(event.at, window)) count += 1;
  }
  return count;
}

/** Goals month is the Phoenix calendar month containing monthDate. */
export function countMonthlyKnocks(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
  userId: string,
  monthDate: Date,
): number {
  const month = phoenixMonthWindow(monthDate);
  return countInWindow(knockIndex(leads, dispositions).byUser.get(userId), {
    startMs: month.startMs,
    endMs: month.endMs,
  });
}

export function dashboardTodayKnocks(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
  now: Date,
  viewerId?: string,
): { total: number; byUser: Map<string, number> } {
  const day = phoenixDayWindow(now);
  const window = { startMs: day.startMs, endMs: day.endMs };
  const byUser = new Map<string, number>();
  let all = 0;
  for (const [userId, events] of knockIndex(leads, dispositions).byUser) {
    const count = countInWindow(events, window);
    if (!count) continue;
    byUser.set(userId, count);
    all += count;
  }
  return { total: viewerId ? (byUser.get(viewerId) ?? 0) : all, byUser };
}

export function countDashboardKnocks(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
  now: Date,
  viewerId?: string,
): number {
  return dashboardTodayKnocks(leads, dispositions, now, viewerId).total;
}

export function activityKnocksByUser(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
  selectedDate: string,
): Map<string, Lead[]> {
  const bounds = phoenixDayWindowFromKey(selectedDate);
  const grouped = new Map<string, Lead[]>();
  if (!bounds) return grouped;
  const index = knockIndex(leads, dispositions);
  const names = new Map<string, string>();
  for (const row of dispositions) {
    if (row?.id) names.set(row.id, row.name);
  }
  const window = { startMs: bounds.startMs, endMs: bounds.endMs };
  for (const event of index.events) {
    if (!instantInWindow(event.at, window)) continue;
    const lead = index.leadsById.get(event.leadId);
    if (!lead) continue;
    const visit: Lead = {
      ...lead,
      status: event.dispositionId,
      disposition: names.get(event.dispositionId) || event.dispositionId,
      dispositionedAt: new Date(event.at),
    };
    const list = grouped.get(event.userId);
    if (list) list.push(visit);
    else grouped.set(event.userId, [visit]);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => new Date(a.dispositionedAt || 0).getTime() - new Date(b.dispositionedAt || 0).getTime());
  }
  return grouped;
}

export function countSetterKnocks(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
  filter: SetterTimeFilter,
  now: Date,
): Record<string, number> {
  const window = setterStatsWindow(filter, now);
  const counts: Record<string, number> = {};
  for (const [userId, events] of knockIndex(leads, dispositions).byUser) {
    const count = countInWindow(events, window);
    if (count) counts[userId] = count;
  }
  return counts;
}

export function mergeSetterKnockCounts<T extends { userId: string; knocks: number }>(
  rows: Map<string, T>,
  counts: Record<string, number>,
  create: (userId: string) => T,
): void {
  for (const [userId, knocks] of Object.entries(counts)) {
    let row = rows.get(userId);
    if (!row) {
      row = create(userId);
      rows.set(userId, row);
    }
    row.knocks = knocks;
  }
}

export type TeamMapStat = { doors: number; appointments: number };

export function teamMapBoard(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
  filter: TeamMapTimeFilter,
  now: Date,
): Map<string, TeamMapStat> {
  const window = teamMapWindow(filter, now);
  const board = new Map<string, TeamMapStat>();
  const ensure = (userId: string): TeamMapStat => {
    let row = board.get(userId);
    if (!row) {
      row = { doors: 0, appointments: 0 };
      board.set(userId, row);
    }
    return row;
  };
  for (const [userId, events] of knockIndex(leads, dispositions).byUser) {
    const doors = countInWindow(events, window);
    if (doors) ensure(userId).doors = doors;
  }
  for (const lead of leads) {
    if (!lead?.claimedBy || !lead.dispositionedAt) continue;
    if (lead.status !== 'appointment' && lead.status !== 'sale') continue;
    const at = new Date(lead.dispositionedAt).getTime();
    if (!Number.isFinite(at) || !instantInWindow(at, window)) continue;
    ensure(lead.claimedBy).appointments += 1;
  }
  return board;
}

export function teamMapStats(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
  userId: string,
  filter: TeamMapTimeFilter,
  now: Date,
): TeamMapStat {
  return teamMapBoard(leads, dispositions, filter, now).get(userId) ?? { doors: 0, appointments: 0 };
}
