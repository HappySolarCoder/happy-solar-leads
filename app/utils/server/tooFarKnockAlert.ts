import { timingSafeEqual } from 'crypto';
import { isTestAccount } from './discordNotification';
import type { UserProfile } from './requireApprovedUser';

export const TOO_FAR_ALERT_TO = 'evan@happyslr.com';
export const LEAD_PAGE = 250;
export const LEAD_PAGE_CAP = 40;
const NY = 'America/New_York';
const ENV_KEYS = ['CRON_SECRET', 'RESEND_API_KEY', 'RESEND_FROM'] as const;

export type TooFarRow = {
  userId: string;
  rep: string;
  tooFar: number;
  total: number;
  percent: string;
};

export type AlertEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
};

export type LeadPageDoc = {
  id: string;
  data: () => Record<string, unknown> | undefined;
  /** Native query cursor for the next page. The route stores the snapshot here. */
  cursor?: unknown;
};

export type LeadPage = {
  size: number;
  docs: LeadPageDoc[];
};

export type TooFarAlertDeps = {
  env: Record<string, string | undefined>;
  now: () => Date;
  fetchPage: (startMs: number, endMs: number, cursor: LeadPageDoc | null) => Promise<LeadPage>;
  getUsers: (uids: string[]) => Promise<Map<string, Record<string, unknown> | null>>;
  claimMarker: (day: string, data: Record<string, unknown>) => Promise<boolean>;
  releaseMarker: (day: string) => Promise<void>;
  sendEmail: (message: AlertEmail) => Promise<void>;
};

type Tally = { tooFar: number; total: number; rep: string };

export function missingAlertEnv(env: Record<string, string | undefined>): string[] {
  return ENV_KEYS.filter((key) => !env[key]?.trim());
}

export function bearerMatches(header: string | null, secret: string): boolean {
  if (!header) return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function millisOf(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'object') {
    const stamp = value as {
      toMillis?: () => number;
      toDate?: () => Date;
      seconds?: number;
      nanoseconds?: number;
    };
    if (typeof stamp.toMillis === 'function') {
      const ms = stamp.toMillis();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof stamp.toDate === 'function') {
      const ms = stamp.toDate().getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof stamp.seconds === 'number' && Number.isFinite(stamp.seconds)) {
      const nanos = typeof stamp.nanoseconds === 'number' ? stamp.nanoseconds : 0;
      return stamp.seconds * 1000 + Math.floor(nanos / 1e6);
    }
  }
  return null;
}

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour) === 24 ? 0 : Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - date.getTime();
}

function zonedStartUtc(year: number, month: number, day: number, timeZone: string): number {
  const wall = Date.UTC(year, month - 1, day, 0, 0, 0);
  const guess = wall - offsetMs(new Date(wall), timeZone);
  return wall - offsetMs(new Date(guess), timeZone);
}

export function nyDayWindow(now: Date): { key: string; label: string; startMs: number; endMs: number } {
  const parts = zonedParts(now, NY);
  const startMs = zonedStartUtc(parts.year, parts.month, parts.day, NY);
  const next = new Date(startMs + 36 * 60 * 60 * 1000);
  const nextParts = zonedParts(next, NY);
  const endMs = zonedStartUtc(nextParts.year, nextParts.month, nextParts.day, NY);
  const key = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(startMs + 12 * 60 * 60 * 1000));
  return { key, label, startMs, endMs };
}

export function overFivePercent(tooFar: number, total: number): boolean {
  return total > 0 && tooFar * 20 > total;
}

export function percentLabel(tooFar: number, total: number): string {
  if (total <= 0) return '0.0%';
  const tenths = Math.round((tooFar * 1000) / total);
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function alertSubject(label: string): string {
  return `Raydar: knocks over 115 ft, ${label}`;
}

export function alertHtml(rows: TooFarRow[]): string {
  const body = rows.map((row) => (
    `<tr><td>${escapeHtml(row.rep)}</td><td>${row.tooFar}</td><td>${row.total}</td><td>${row.percent}</td></tr>`
  )).join('');
  return '<table><thead><tr><th>rep</th><th>knocks over 115 ft</th><th>total knocks</th><th>%</th></tr></thead>'
    + `<tbody>${body}</tbody></table>`;
}

function historyEntries(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
}

export function tallyKnocks(
  leads: Array<{ id: string; data: Record<string, unknown> }>,
  startMs: number,
  endMs: number,
): Map<string, Tally> {
  const tallies = new Map<string, Tally>();
  for (const lead of leads) {
    for (const entry of historyEntries(lead.data.dispositionHistory)) {
      const at = millisOf(entry.timestamp);
      if (at == null || at < startMs || at >= endMs) continue;
      const userId = entry.userId;
      if (typeof userId !== 'string' || !userId) continue;
      const current = tallies.get(userId) ?? { tooFar: 0, total: 0, rep: userId };
      current.total += 1;
      const flag = entry.gpsFlag;
      if (flag && typeof flag === 'object' && (flag as { gpsUnverifiedReason?: unknown }).gpsUnverifiedReason === 'too_far') {
        current.tooFar += 1;
      }
      if (typeof entry.userName === 'string' && entry.userName.trim()) current.rep = entry.userName.trim();
      tallies.set(userId, current);
    }
  }
  return tallies;
}

function blockedTestUser(uid: string, user: Record<string, unknown> | null): boolean {
  if (!user) return false;
  if (isTestAccount(uid, user as UserProfile)) return true;
  return user.team === 'TEST';
}

export function rowsFromTallies(
  tallies: Map<string, Tally>,
  users: Map<string, Record<string, unknown> | null>,
): TooFarRow[] {
  const rows: TooFarRow[] = [];
  for (const [userId, tally] of tallies) {
    const user = users.get(userId) ?? null;
    if (blockedTestUser(userId, user)) continue;
    if (!overFivePercent(tally.tooFar, tally.total)) continue;
    const named = user && typeof user.name === 'string' && user.name.trim() ? user.name.trim() : tally.rep;
    rows.push({
      userId,
      rep: named,
      tooFar: tally.tooFar,
      total: tally.total,
      percent: percentLabel(tally.tooFar, tally.total),
    });
  }
  rows.sort((a, b) => b.tooFar - a.tooFar || a.rep.localeCompare(b.rep));
  return rows;
}

export async function loadDispositionedLeads(
  fetchPage: TooFarAlertDeps['fetchPage'],
  startMs: number,
  endMs: number,
): Promise<{ leads: Array<{ id: string; data: Record<string, unknown> }>; truncated: boolean }> {
  const leads: Array<{ id: string; data: Record<string, unknown> }> = [];
  let cursor: LeadPageDoc | null = null;
  for (let page = 0; page < LEAD_PAGE_CAP; page += 1) {
    const snap = await fetchPage(startMs, endMs, cursor);
    for (const doc of snap.docs) {
      leads.push({ id: doc.id, data: doc.data() ?? {} });
    }
    if (snap.docs.length < LEAD_PAGE) return { leads, truncated: false };
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (!cursor) return { leads, truncated: false };
  }
  console.log('[too-far-alert] leads_truncated 1');
  return { leads, truncated: true };
}

export async function handleTooFarKnockAlert(
  request: { headers: { get(name: string): string | null }; nextUrl: { searchParams: { get(name: string): string | null } } },
  deps: TooFarAlertDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const missing = missingAlertEnv(deps.env);
  const secret = deps.env.CRON_SECRET?.trim();
  if (secret && !bearerMatches(request.headers.get('authorization'), secret)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  if (missing.length) return { status: 503, body: { missing } };

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  const day = nyDayWindow(deps.now());
  const loaded = await loadDispositionedLeads(deps.fetchPage, day.startMs, day.endMs);
  const tallies = tallyKnocks(loaded.leads, day.startMs, day.endMs);
  const users = tallies.size ? await deps.getUsers([...tallies.keys()]) : new Map<string, Record<string, unknown> | null>();
  const rows = rowsFromTallies(tallies, users);
  const email = rows.length
    ? {
      from: deps.env.RESEND_FROM!.trim(),
      to: TOO_FAR_ALERT_TO,
      subject: alertSubject(day.label),
      html: alertHtml(rows),
    }
    : null;

  if (dryRun) {
    return {
      status: 200,
      body: { ok: true, dryRun: true, date: day.key, rows, email, truncated: loaded.truncated },
    };
  }
  if (!email) {
    return { status: 200, body: { ok: true, sent: false, date: day.key, rows, truncated: loaded.truncated } };
  }

  const claimed = await deps.claimMarker(day.key, {
    date: day.key,
    to: TOO_FAR_ALERT_TO,
    rowCount: rows.length,
    sentAt: deps.now().toISOString(),
  });
  if (!claimed) {
    return { status: 200, body: { ok: true, sent: false, alreadySent: true, date: day.key, rows } };
  }
  try {
    await deps.sendEmail(email);
  } catch (error) {
    await deps.releaseMarker(day.key);
    console.error('[too-far-alert] send failed', error instanceof Error ? error.message : 'error');
    return { status: 502, body: { ok: false, error: 'send_failed' } };
  }
  console.log(`[too-far-alert] sent ${day.key} ${rows.length}`);
  return { status: 200, body: { ok: true, sent: true, date: day.key, rows, truncated: loaded.truncated } };
}
