import { timingSafeEqual } from 'crypto';
import { isTestAccount } from './discordNotification';
import type { UserProfile } from './requireApprovedUser';
import { isExcludedTestLead } from './allLeadsStats';
import {
  GPS_ACCURACY_CREDIT_CAP_M,
  GPS_MAX_VERIFIED_ACCURACY_M,
  RADIUS_M,
} from '@/app/utils/gpsRule';
import { DEFAULT_DISPOSITIONS } from '@/app/types/disposition';

export const TOO_FAR_ALERT_TO = 'evan@happyslr.com';
export const LEAD_PAGE = 250;
export const LEAD_PAGE_CAP = 40;
const NY = 'America/New_York';
const ENV_KEYS = ['CRON_SECRET', 'RESEND_API_KEY', 'RESEND_FROM'] as const;
const SEND_ENV_KEYS = ['RESEND_API_KEY', 'RESEND_FROM'] as const;
/** The cron fires at 03:30 and 04:30 UTC. Only the one landing in NY hour 23 runs. */
export const RUN_NY_HOUR = 23;
const DATE_PARAM = /^(\d{4})-(\d{2})-(\d{2})$/;
const M_TO_FT = 3.28084;
/**
 * Projection for the leads query. dispositionedAt must stay: startAfter(doc)
 * reads the orderBy field from the snapshot. Only entry.gpsFlag is used for
 * counting; top-level GPS fields are never read.
 */
export const LEAD_SELECT_FIELDS = ['dispositionedAt', 'dispositionHistory', 'testData', 'isTestAccount'] as const;

export type DispositionDef = { id?: unknown; name?: unknown; countsAsDoorKnock?: unknown };

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
  /** Custom dispositions (one small collection read). Defaults fill the gaps. */
  getDispositions: () => Promise<DispositionDef[]>;
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
  const creditFt = Math.round(GPS_ACCURACY_CREDIT_CAP_M * M_TO_FT);
  const radiusFt = Math.round(RADIUS_M * M_TO_FT);
  return `<p>A knock counts as far when its distance from the house, minus up to ${GPS_ACCURACY_CREDIT_CAP_M} m (${creditFt} ft) of GPS accuracy credit, is over ${RADIUS_M} m (${radiusFt} ft).</p>`
    + '<table><thead><tr><th>rep</th><th>knocks over 115 ft</th><th>total knocks</th><th>%</th></tr></thead>'
    + `<tbody>${body}</tbody></table>`;
}

function historyEntries(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
}

function dispositionKeys(value: { id?: unknown; name?: unknown }): string[] {
  const keys: string[] = [];
  if (typeof value.id === 'string' && value.id.trim()) keys.push(value.id.trim().toLowerCase());
  if (typeof value.name === 'string' && value.name.trim()) {
    const name = value.name.trim().toLowerCase();
    keys.push(name, name.replace(/\s+/g, '-'));
  }
  return keys;
}

/**
 * Lower-cased ids and names (plus hyphenated names) of dispositions with
 * countsAsDoorKnock === true. Same matching as the dashboard. A stored
 * disposition overrides the default with the same id or name.
 */
export function doorKnockKeys(custom: DispositionDef[]): Set<string> {
  const knock = new Set<string>();
  const seen = new Set<string>();
  for (const def of custom) {
    const keys = dispositionKeys(def);
    keys.forEach((key) => seen.add(key));
    if (def.countsAsDoorKnock === true) keys.forEach((key) => knock.add(key));
  }
  for (const def of DEFAULT_DISPOSITIONS) {
    const keys = dispositionKeys(def);
    if (keys.some((key) => seen.has(key))) continue;
    if (def.countsAsDoorKnock) keys.forEach((key) => knock.add(key));
  }
  return knock;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Far = the entry's own gpsFlag says too_far, or out_of_area on a good fix
 * that is also past the distance rule. out_of_area is only chosen after the
 * no_fix/stale/low/reduced accuracy checks, so the reason itself means the
 * fix was good. Entries do not store accuracy today; with no accuracy the
 * full 15 m credit is assumed (conservative: fewer alerts). An accuracy
 * over 65 m is not a good fix. The lead's top-level GPS fields are never read.
 */
export function entryIsFar(entry: Record<string, unknown>): boolean {
  const flag = entry.gpsFlag;
  if (!flag || typeof flag !== 'object') return false;
  const { gpsUnverifiedReason: reason, gpsDistanceM, gpsAccuracyM } = flag as Record<string, unknown>;
  if (reason === 'too_far') return true;
  if (reason !== 'out_of_area') return false;
  const distance = finiteNumber(gpsDistanceM);
  if (distance == null || distance < 0) return false;
  const accuracy = finiteNumber(gpsAccuracyM);
  if (accuracy != null && (accuracy < 0 || accuracy > GPS_MAX_VERIFIED_ACCURACY_M)) return false;
  const credit = accuracy == null ? GPS_ACCURACY_CREDIT_CAP_M : Math.min(accuracy, GPS_ACCURACY_CREDIT_CAP_M);
  return distance - credit > RADIUS_M;
}

export function tallyKnocks(
  leads: Array<{ id: string; data: Record<string, unknown> }>,
  startMs: number,
  endMs: number,
  knockKeys: Set<string> = doorKnockKeys([]),
): Map<string, Tally> {
  const tallies = new Map<string, Tally>();
  for (const lead of leads) {
    if (isExcludedTestLead(lead.id, lead.data)) continue;
    for (const entry of historyEntries(lead.data.dispositionHistory)) {
      const at = millisOf(entry.timestamp);
      if (at == null || at < startMs || at >= endMs) continue;
      const userId = entry.userId;
      if (typeof userId !== 'string' || !userId) continue;
      const disposition = typeof entry.disposition === 'string' ? entry.disposition.trim().toLowerCase() : '';
      if (!disposition || !knockKeys.has(disposition)) continue;
      const current = tallies.get(userId) ?? { tooFar: 0, total: 0, rep: userId };
      current.total += 1;
      if (entryIsFar(entry)) current.tooFar += 1;
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

export function nyHour(now: Date): number {
  return zonedParts(now, NY).hour;
}

/** Strict YYYY-MM-DD, a real calendar day, not after today in NY. */
export function parseDateParam(value: string, now: Date): ReturnType<typeof nyDayWindow> | null {
  const match = DATE_PARAM.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  if (year < 2020) return null;
  const window = nyDayWindow(new Date(zonedStartUtc(year, month, day, NY) + 12 * 60 * 60 * 1000));
  if (window.key !== value || window.key > nyDayWindow(now).key) return null;
  return window;
}

export async function handleTooFarKnockAlert(
  request: { headers: { get(name: string): string | null }; nextUrl: { searchParams: { get(name: string): string | null } } },
  deps: TooFarAlertDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const secret = deps.env.CRON_SECRET?.trim();
  if (!secret) return { status: 503, body: { missing: missingAlertEnv(deps.env) } };
  if (!bearerMatches(request.headers.get('authorization'), secret)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }

  const params = request.nextUrl.searchParams;
  const dryRun = params.get('dryRun') === '1';
  const now = deps.now();
  const dateParam = params.get('date');
  let day = nyDayWindow(now);
  if (dateParam != null) {
    const parsed = parseDateParam(dateParam, now);
    if (!parsed) return { status: 400, body: { error: 'invalid_date', expected: 'YYYY-MM-DD, not after today (America/New_York)' } };
    day = parsed;
  }
  const missingSend = SEND_ENV_KEYS.filter((key) => !deps.env[key]?.trim());
  if (!dryRun && missingSend.length) return { status: 503, body: { missing: missingSend } };
  // Scheduled runs (no date, not a dry run) fire at 03:30 and 04:30 UTC; only NY hour 23 proceeds.
  if (!dryRun && dateParam == null && nyHour(now) !== RUN_NY_HOUR) {
    return { status: 200, body: { ok: true, skipped: true, reason: 'not_ny_hour_23', nyHour: nyHour(now) } };
  }

  const loaded = await loadDispositionedLeads(deps.fetchPage, day.startMs, day.endMs);
  if (loaded.truncated && !dryRun) {
    console.error(`[too-far-alert] truncated ${day.key}; not sending a partial email`);
    return { status: 503, body: { ok: false, sent: false, truncated: true, date: day.key } };
  }
  const knockKeys = loaded.leads.length ? doorKnockKeys(await deps.getDispositions()) : new Set<string>();
  const tallies = tallyKnocks(loaded.leads, day.startMs, day.endMs, knockKeys);
  const users = tallies.size ? await deps.getUsers([...tallies.keys()]) : new Map<string, Record<string, unknown> | null>();
  const rows = rowsFromTallies(tallies, users);
  const email = rows.length
    ? {
      from: deps.env.RESEND_FROM?.trim() || '(RESEND_FROM unset)',
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
    return { status: 200, body: { ok: true, sent: false, date: day.key, rows, truncated: false } };
  }

  const claimed = await deps.claimMarker(day.key, {
    date: day.key,
    to: TOO_FAR_ALERT_TO,
    rowCount: rows.length,
    sentAt: now.toISOString(),
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
  return { status: 200, body: { ok: true, sent: true, date: day.key, rows, truncated: false } };
}
