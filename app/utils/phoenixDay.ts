/** Web knock days use America/Phoenix. The zone does not observe DST. */
export const PHOENIX_TIME_ZONE = 'America/Phoenix';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

function zonedParts(date: Date): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: PHOENIX_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value;
  const hour = Number(bag.hour);
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: hour === 24 ? 0 : hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
    weekday: WEEKDAYS.indexOf(bag.weekday),
  };
}

function offsetMs(date: Date): number {
  const parts = zonedParts(date);
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - date.getTime();
}

function zonedStartUtc(year: number, month: number, day: number): number {
  const wall = Date.UTC(year, month - 1, day, 0, 0, 0);
  const guess = wall - offsetMs(new Date(wall));
  return wall - offsetMs(new Date(guess));
}

export type PhoenixWindow = {
  key: string;
  /** Inclusive. */
  startMs: number;
  /** Exclusive. */
  endMs: number;
};

function dayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function phoenixDayKey(at: number): string {
  const parts = zonedParts(new Date(at));
  return dayKey(parts.year, parts.month, parts.day);
}

export function phoenixHourDecimal(at: number): number {
  const parts = zonedParts(new Date(at));
  return parts.hour + parts.minute / 60;
}

export function phoenixDayWindow(now: Date): PhoenixWindow {
  const parts = zonedParts(now);
  const startMs = zonedStartUtc(parts.year, parts.month, parts.day);
  const next = zonedParts(new Date(startMs + 36 * 60 * 60 * 1000));
  return {
    key: dayKey(parts.year, parts.month, parts.day),
    startMs,
    endMs: zonedStartUtc(next.year, next.month, next.day),
  };
}

/** A YYYY-MM-DD date input is a Phoenix calendar day, not a browser-local day. */
export function phoenixDayWindowFromKey(key: string): PhoenixWindow | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const startMs = zonedStartUtc(year, month, day);
  const check = zonedParts(new Date(startMs + 12 * 60 * 60 * 1000));
  if (check.year !== year || check.month !== month || check.day !== day) return null;
  const next = zonedParts(new Date(startMs + 36 * 60 * 60 * 1000));
  return {
    key,
    startMs,
    endMs: zonedStartUtc(next.year, next.month, next.day),
  };
}

export function phoenixWeekStartMs(now: Date): number {
  const day = phoenixDayWindow(now);
  const parts = zonedParts(now);
  return day.startMs - parts.weekday * 24 * 60 * 60 * 1000;
}

export function phoenixMonthWindow(now: Date): { startMs: number; endMs: number } {
  const parts = zonedParts(now);
  const startMs = zonedStartUtc(parts.year, parts.month, 1);
  const nextMonth = parts.month === 12 ? 1 : parts.month + 1;
  const nextYear = parts.month === 12 ? parts.year + 1 : parts.year;
  return { startMs, endMs: zonedStartUtc(nextYear, nextMonth, 1) };
}

export function phoenixPreviousMonthWindow(now: Date): { startMs: number; endMs: number } {
  const current = phoenixMonthWindow(now);
  const previous = zonedParts(new Date(current.startMs - 24 * 60 * 60 * 1000));
  return {
    startMs: zonedStartUtc(previous.year, previous.month, 1),
    endMs: current.startMs,
  };
}
