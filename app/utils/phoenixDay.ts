/** Web knock days use America/Phoenix. The zone does not observe DST, so the offset is fixed. */
export const PHOENIX_TIME_ZONE = 'America/Phoenix';

const PHOENIX_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PhoenixWindow = {
  key: string;
  /** Inclusive. */
  startMs: number;
  /** Exclusive. */
  endMs: number;
};

function shifted(at: number): Date {
  return new Date(at - PHOENIX_OFFSET_MS);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function phoenixDayKey(at: number): string {
  const date = shifted(at);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function phoenixHourDecimal(at: number): number {
  const date = shifted(at);
  return date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
}

function midnightMs(year: number, monthIndex: number, day: number): number {
  return Date.UTC(year, monthIndex, day, 7, 0, 0, 0);
}

export function phoenixDayWindow(now: Date): PhoenixWindow {
  const date = shifted(now.getTime());
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const startMs = midnightMs(year, month, day);
  return {
    key: `${year}-${pad(month + 1)}-${pad(day)}`,
    startMs,
    endMs: startMs + DAY_MS,
  };
}

/** A YYYY-MM-DD date input is a Phoenix calendar day, not a browser-local day. */
export function phoenixDayWindowFromKey(key: string): PhoenixWindow | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const startMs = midnightMs(year, month - 1, day);
  const check = shifted(startMs);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return { key, startMs, endMs: startMs + DAY_MS };
}

export function phoenixWeekStartMs(now: Date): number {
  const day = phoenixDayWindow(now);
  const weekday = shifted(now.getTime()).getUTCDay();
  return day.startMs - weekday * DAY_MS;
}

export function phoenixMonthWindow(now: Date): { startMs: number; endMs: number } {
  const date = shifted(now.getTime());
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    startMs: midnightMs(year, month, 1),
    endMs: midnightMs(year, month + 1, 1),
  };
}

export function phoenixPreviousMonthWindow(now: Date): { startMs: number; endMs: number } {
  const current = phoenixMonthWindow(now);
  const previous = shifted(current.startMs - DAY_MS);
  return {
    startMs: midnightMs(previous.getUTCFullYear(), previous.getUTCMonth(), 1),
    endMs: current.startMs,
  };
}
