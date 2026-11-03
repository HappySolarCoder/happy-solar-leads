import type { Disposition } from '@/app/types/disposition';
import type { Lead } from '@/app/types';
import { collectKnockEvents } from '@/app/utils/knockCount';
import { endOfMonth, isAfter, isBefore, startOfDay, startOfMonth, startOfWeek } from 'date-fns';

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

export type ExclusiveWindow = {
  cutoff: Date;
  end?: Date;
};

/**
 * Setter stats compares with date-fns isAfter, so both edges are exclusive.
 * lastmonth is the previous calendar month.
 */
export function setterStatsWindow(filter: SetterTimeFilter, now: Date): ExclusiveWindow {
  switch (filter) {
    case 'today':
      return { cutoff: startOfDay(now) };
    case 'yesterday':
      return {
        cutoff: new Date(startOfDay(now).getTime() - 86400000),
        end: startOfDay(now),
      };
    case 'last7days':
      return { cutoff: new Date(now.getTime() - 7 * 86400000) };
    case 'thisweek':
      return { cutoff: startOfWeek(now) };
    case 'lastweek':
      return { cutoff: new Date(startOfWeek(now).getTime() - 7 * 86400000) };
    case 'thismonth':
      return { cutoff: startOfMonth(now) };
    case 'lastmonth': {
      const thisMonth = startOfMonth(now);
      return {
        cutoff: startOfMonth(new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 1, 1)),
        end: thisMonth,
      };
    }
    default:
      return { cutoff: new Date(0) };
  }
}

/**
 * Team map uses the same exclusive edges. lastmonth is 30 days before the
 * start of this month, with no upper bound — that is the boundary this page
 * already used.
 */
export function teamMapWindow(filter: TeamMapTimeFilter, now: Date): ExclusiveWindow {
  switch (filter) {
    case 'today':
      return { cutoff: startOfDay(now) };
    case 'yesterday':
      return {
        cutoff: new Date(startOfDay(now).getTime() - 86400000),
        end: startOfDay(now),
      };
    case 'last7days':
      return { cutoff: new Date(now.getTime() - 7 * 86400000) };
    case 'thisweek':
      return { cutoff: startOfWeek(now) };
    case 'lastweek':
      return { cutoff: new Date(startOfWeek(now).getTime() - 7 * 86400000) };
    case 'thismonth':
      return { cutoff: startOfMonth(now) };
    case 'lastmonth':
      return { cutoff: new Date(startOfMonth(now).getTime() - 30 * 86400000) };
    default:
      return { cutoff: new Date(0) };
  }
}

export function dateInExclusiveWindow(date: Date, window: ExclusiveWindow): boolean {
  if (!isAfter(date, window.cutoff)) return false;
  if (window.end && !isAfter(window.end, date)) return false;
  return true;
}

function eventsInExclusiveWindow(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
  window: ExclusiveWindow,
) {
  return collectKnockEvents(leads, dispositions).filter((event) =>
    dateInExclusiveWindow(new Date(event.at), window),
  );
}

/** Goals month is inclusive of startOfMonth and endOfMonth, in local time. */
export function countMonthlyKnocks(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
  userId: string,
  monthDate: Date,
): number {
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  return collectKnockEvents(leads, dispositions).filter((event) => {
    if (event.userId !== userId) return false;
    const at = new Date(event.at);
    return !isBefore(at, start) && !isAfter(at, end);
  }).length;
}

/**
 * Dashboard knocks use the local calendar day of each event, the same
 * setHours comparison the page used on dispositionedAt.
 */
export function countDashboardKnocks(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
  now: Date,
): number {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return collectKnockEvents(leads, dispositions).filter((event) => {
    const at = new Date(event.at);
    at.setHours(0, 0, 0, 0);
    return at.getTime() === today.getTime();
  }).length;
}

export function activityDayBounds(selectedDate: string): { start: Date; end: Date } | null {
  if (!selectedDate) return null;
  const [y, m, d] = selectedDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  return {
    start: new Date(y, m - 1, d, 0, 0, 0, 0),
    end: new Date(y, m - 1, d, 23, 59, 59, 999),
  };
}

/**
 * One display lead per counted visit on the selected local day.
 * dispositionedAt is the visit time. Credit goes to the history actor.
 */
export function activityKnocksByUser(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
  selectedDate: string,
): Map<string, Lead[]> {
  const bounds = activityDayBounds(selectedDate);
  const grouped = new Map<string, Lead[]>();
  if (!bounds) return grouped;
  const start = bounds.start.getTime();
  const end = bounds.end.getTime();
  for (const event of collectKnockEvents(leads, dispositions)) {
    if (event.at < start || event.at > end) continue;
    const lead = leads.find((row) => row.id === event.leadId);
    if (!lead) continue;
    const name = dispositions.find((row) => row.id === event.dispositionId)?.name;
    const visit: Lead = {
      ...lead,
      status: event.dispositionId,
      disposition: name || event.dispositionId,
      dispositionedAt: new Date(event.at),
    };
    const list = grouped.get(event.userId) ?? [];
    list.push(visit);
    grouped.set(event.userId, list);
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
  const counts: Record<string, number> = {};
  for (const event of eventsInExclusiveWindow(leads, dispositions, setterStatsWindow(filter, now))) {
    counts[event.userId] = (counts[event.userId] || 0) + 1;
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

export function teamMapStats(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
  userId: string,
  filter: TeamMapTimeFilter,
  now: Date,
): { doors: number; appointments: number } {
  const window = teamMapWindow(filter, now);
  const doors = eventsInExclusiveWindow(leads, dispositions, window).filter(
    (event) => event.userId === userId,
  ).length;
  const appointments = leads.filter((lead) => {
    if (lead.claimedBy !== userId || !lead.dispositionedAt) return false;
    if (!dateInExclusiveWindow(new Date(lead.dispositionedAt), window)) return false;
    return lead.status === 'appointment' || lead.status === 'sale';
  }).length;
  return { doors, appointments };
}
