import { apiFetch } from './apiFetch';

/** Server route. Native calls go through apiFetch to NEXT_PUBLIC_API_BASE_URL. */
export const SCHEDULING_ROUTE_PATH = '/api/notifications/discord';
/** Production web origin. apiFetch already requires this HTTPS origin on device. */
export const SCHEDULING_API_ORIGIN = 'https://happy-solar-leads.vercel.app';

export const AMBIGUOUS_SEND_MESSAGE =
  "Couldn't confirm it was sent. Check with the scheduling manager before sending again.";
export const NOT_CONFIGURED_MESSAGE =
  "Scheduling isn't set up on the server right now. Nothing was sent.";
export const SIGN_IN_AGAIN_MESSAGE = 'Sign in again, then send.';
export const SCHEDULING_BLOCKED_MESSAGE = "Scheduling isn't available for this account.";
export const SCHEDULING_ROUTE_UNAVAILABLE_MESSAGE = "Scheduling isn't available right now.";

const BILL_PATTERN = /^[0-9]{1,7}(\.[0-9]{1,2})?$/;
const DEFAULT_TIMEOUT_MS = 20_000;

export interface SchedulingPayload {
  kind: 'scheduling';
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email?: string;
  estimatedBill?: string;
  notes?: string;
  solarScore?: number;
  solarSunshineHours?: number;
  solarMaxPanels?: number;
  hasSouthFacingRoof?: boolean;
}

export interface SchedulingFormInput {
  name?: unknown;
  address?: unknown;
  city?: unknown;
  state?: unknown;
  zip?: unknown;
  phone?: unknown;
  email?: unknown;
  estimatedBill?: unknown;
  notes?: unknown;
}

export interface SchedulingSolarInput {
  solarScore?: unknown;
  solarSunshineHours?: unknown;
  solarMaxPanels?: unknown;
  hasSouthFacingRoof?: unknown;
}

export type SchedulingBuild =
  | { ok: true; payload: SchedulingPayload }
  | { ok: false; message: string };

export type SchedulingOutcome =
  | { status: 'sent' }
  | { status: 'signin'; message: string }
  | { status: 'blocked'; message: string }
  | { status: 'rateLimited'; retryAfterSec: number; message: string }
  | { status: 'unavailable'; message: string }
  | { status: 'invalid'; message: string }
  | { status: 'notConfigured'; message: string }
  | { status: 'ambiguous'; message: string };

export interface SchedulingSendDeps {
  getToken: (forceRefresh: boolean) => Promise<string>;
  post?: (path: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  /** Remember a 403 for this account so Send stays disabled after a remount. */
  accountId?: string;
}

const blockedAccounts = new Set<string>();

export function resetSchedulingSendBlocksForTests(): void {
  blockedAccounts.clear();
}

export function rememberSchedulingBlock(uid: string): void {
  if (uid) blockedAccounts.add(uid);
}

export function schedulingBlockedFor(uid?: string | null): boolean {
  if (!uid) return false;
  return blockedAccounts.has(uid);
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
}

function normalizeBill(value: unknown): 'omit' | 'invalid' | string {
  if (value == null) return 'omit';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'invalid';
    const text = String(value);
    if (!BILL_PATTERN.test(text) || Number(text) > 1_000_000) return 'invalid';
    return text;
  }
  const cleaned = cleanText(value).replace(/[$,\s]/g, '').replace(/\/mo$/i, '');
  if (!cleaned) return 'omit';
  if (!BILL_PATTERN.test(cleaned) || Number(cleaned) > 1_000_000) return 'invalid';
  return cleaned;
}

function solarInRange(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) return undefined;
  return value;
}

export function buildSchedulingPayload(
  form: SchedulingFormInput,
  lead?: SchedulingSolarInput | null,
  fieldContext?: string,
): SchedulingBuild {
  const problems: string[] = [];
  const name = cleanText(form.name);
  const address = cleanText(form.address);
  const city = cleanText(form.city);
  const state = cleanText(form.state).toUpperCase();
  const phone = cleanText(form.phone);
  const email = cleanText(form.email);
  let notes = cleanText(form.notes);
  const zipStripped = cleanText(form.zip).replace(/\s+/g, '');
  const zip = /^\d{9}$/.test(zipStripped) ? `${zipStripped.slice(0, 5)}-${zipStripped.slice(5)}` : zipStripped;

  if (name.length < 1 || name.length > 120) problems.push('Name (1–120 characters)');
  if (address.length < 1 || address.length > 200) problems.push('Street address (1–200 characters)');
  if (city.length < 1 || city.length > 80) problems.push('City (1–80 characters)');
  if (!/^[A-Z]{2}$/.test(state)) problems.push('State (2 letters)');
  if (!/^\d{5}(-\d{4})?$/.test(zip)) problems.push('ZIP (5 digits or ZIP+4)');
  if (phone.length < 1 || phone.length > 40) problems.push('Phone (1–40 characters)');
  if (email.length > 120) problems.push('Email (120 characters or fewer)');
  if (notes.length > 800) problems.push('Notes (800 characters or fewer)');

  const bill = normalizeBill(form.estimatedBill);
  if (bill === 'invalid') problems.push('Estimated bill (up to 1,000,000)');

  if (problems.length > 0) {
    return { ok: false, message: `Fix these before sending: ${problems.join(', ')}` };
  }

  const context = cleanText(fieldContext);
  if (context) {
    const suffix = `Field context: ${context}`;
    const combined = notes ? `${notes}\n${suffix}` : suffix;
    if (combined.length <= 800) notes = combined;
  }

  const payload: SchedulingPayload = {
    kind: 'scheduling',
    name,
    address,
    city,
    state,
    zip,
    phone,
  };
  if (email) payload.email = email;
  if (bill !== 'omit') payload.estimatedBill = bill;
  if (notes) payload.notes = notes;

  const solarScore = solarInRange(lead?.solarScore, 100);
  const solarSunshineHours = solarInRange(lead?.solarSunshineHours, 100_000);
  const solarMaxPanels = solarInRange(lead?.solarMaxPanels, 100_000);
  if (solarScore !== undefined) payload.solarScore = solarScore;
  if (solarSunshineHours !== undefined) payload.solarSunshineHours = solarSunshineHours;
  if (solarMaxPanels !== undefined) payload.solarMaxPanels = solarMaxPanels;
  if (typeof lead?.hasSouthFacingRoof === 'boolean') payload.hasSouthFacingRoof = lead.hasSouthFacingRoof;

  return { ok: true, payload };
}

export function safeServerError(status: number, body: unknown): string {
  const error = body && typeof body === 'object' && 'error' in body
    ? (body as { error?: unknown }).error
    : undefined;
  if (
    typeof error === 'string' &&
    error.length <= 200 &&
    !/http/i.test(error) &&
    !/webhook/i.test(error)
  ) {
    return error;
  }
  return `Failed to send notification (${status}).`;
}

function signin(): SchedulingOutcome {
  return { status: 'signin', message: SIGN_IN_AGAIN_MESSAGE };
}

function ambiguous(): SchedulingOutcome {
  return { status: 'ambiguous', message: AMBIGUOUS_SEND_MESSAGE };
}

function retryAfterSeconds(response: Response): number {
  const raw = response.headers.get('retry-after');
  if (raw == null) return 60;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return 60;
  const seconds = Number(trimmed);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) return 60;
  return seconds;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function outcomeForStatus(response: Response, accountId?: string): Promise<SchedulingOutcome> {
  const status = response.status;
  if (status >= 200 && status < 300) return { status: 'sent' };
  if (status === 401) return signin();
  if (status === 403) {
    const shown = safeServerError(status, await readJson(response));
    const message = shown === `Failed to send notification (${status}).` ? SCHEDULING_BLOCKED_MESSAGE : shown;
    if (accountId) rememberSchedulingBlock(accountId);
    return { status: 'blocked', message };
  }
  if (status === 429) {
    const retryAfterSec = retryAfterSeconds(response);
    return {
      status: 'rateLimited',
      retryAfterSec,
      message: `Too many requests. You can send again in ${retryAfterSec} seconds.`,
    };
  }
  if (status === 404) return { status: 'unavailable', message: SCHEDULING_ROUTE_UNAVAILABLE_MESSAGE };
  if (status === 400) return { status: 'invalid', message: safeServerError(status, await readJson(response)) };
  if (status === 503) return { status: 'notConfigured', message: NOT_CONFIGURED_MESSAGE };
  return ambiguous();
}

type Delivery =
  | { kind: 'timeout' }
  | { kind: 'error' }
  | { kind: 'response'; response: Response };

/**
 * One POST. A 20s race ignores a late native result (that transport cannot be cancelled).
 * The caller must not start another POST after timeout.
 */
async function deliver(
  post: (path: string, init: RequestInit) => Promise<Response>,
  payload: SchedulingPayload,
  token: string,
  timeoutMs: number,
): Promise<Delivery> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Delivery>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: 'timeout' });
    }, timeoutMs);
  });
  const attempt = Promise.resolve()
    .then(() => post(SCHEDULING_ROUTE_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }))
    .then((response) => ({ kind: 'response', response }) as Delivery)
    .catch(() => ({ kind: 'error' }) as Delivery);
  const winner = await Promise.race([attempt, timeout]);
  if (timer) clearTimeout(timer);
  return winner;
}

async function finish(delivery: Delivery, accountId?: string): Promise<SchedulingOutcome> {
  if (delivery.kind !== 'response') return ambiguous();
  return outcomeForStatus(delivery.response, accountId);
}

/**
 * Posts a scheduling notification. The only automatic retry is one token refresh after 401,
 * because the server checks auth before it posts. 500, 502, timeouts, and network errors
 * are ambiguous and are never retried. 503 means the server is not configured and nothing was posted.
 */
export async function sendSchedulingNotification(
  payload: SchedulingPayload,
  deps: SchedulingSendDeps,
): Promise<SchedulingOutcome> {
  const post = deps.post ?? apiFetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let token: string;
  try {
    token = await deps.getToken(false);
  } catch {
    return signin();
  }
  if (!token) return signin();

  const first = await deliver(post, payload, token, timeoutMs);
  if (first.kind === 'response' && first.response.status === 401) {
    let refreshed: string;
    try {
      refreshed = await deps.getToken(true);
    } catch {
      return signin();
    }
    if (!refreshed) return signin();
    return finish(await deliver(post, payload, refreshed, timeoutMs), deps.accountId);
  }
  return finish(first, deps.accountId);
}
