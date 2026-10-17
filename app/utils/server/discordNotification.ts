import { isExcludedTestLead } from './allLeadsStats';
import {
  HttpError,
  requireApprovedUser,
  type RequireApprovedUserDeps,
  type UserProfile,
} from './requireApprovedUser';

export const DISCORD_NOTIFICATION_LIMIT = 8;
export const DISCORD_NOTIFICATION_WINDOW_MS = 60_000;
export const DISCORD_CONTENT_MAX = 2000;
export const DISCORD_TEST_CONTENT =
  '🧪 Test notification from Raydar - Scheduling Manager integration working!';

const HITS = new Map<string, number[]>();

const SCHEDULING_KEYS = new Set([
  'kind',
  'name',
  'address',
  'city',
  'state',
  'zip',
  'phone',
  'email',
  'estimatedBill',
  'notes',
  'solarScore',
  'solarSunshineHours',
  'solarMaxPanels',
  'hasSouthFacingRoof',
]);

export type DiscordPostBody = {
  content: string;
  allowed_mentions: { parse: string[] };
};

export type RateLimitStore = Map<string, number[]>;

export type DiscordNotificationDeps = RequireApprovedUserDeps & {
  resolveWebhookUrl: () => Promise<string | null>;
  postDiscord: (url: string, body: DiscordPostBody) => Promise<{ ok: boolean; status: number }>;
  now?: () => number;
  rateLimitStore?: RateLimitStore;
};

type SchedulingFields = {
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
};

type ParsedNotification =
  | { ok: true; kind: 'test' }
  | { ok: true; kind: 'scheduling'; fields: SchedulingFields }
  | { ok: false; error: string };

export function resetDiscordNotificationRateLimit(): void {
  HITS.clear();
}

export function allowDiscordNotification(
  uid: string,
  now: number,
  store: RateLimitStore = HITS,
  limit = DISCORD_NOTIFICATION_LIMIT,
  windowMs = DISCORD_NOTIFICATION_WINDOW_MS,
): boolean {
  const recent = (store.get(uid) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= limit) {
    store.set(uid, recent);
    return false;
  }
  recent.push(now);
  store.set(uid, recent);
  return true;
}

/** Seconds until the oldest hit in the current window expires. At least 1. */
export function discordRetryAfterSeconds(
  uid: string,
  now: number,
  store: RateLimitStore = HITS,
  windowMs = DISCORD_NOTIFICATION_WINDOW_MS,
): number {
  const recent = (store.get(uid) ?? []).filter((at) => now - at < windowMs);
  if (recent.length === 0) return Math.ceil(windowMs / 1000);
  const oldest = Math.min(...recent);
  return Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
}

/**
 * Seeded local users use @test.com and user-test-* ids. A profile can also
 * be marked with isTest, testAccount, or accountType "test".
 * isTestAccount and testData use the same helper as the stats test-lead filter.
 */
export function isTestAccount(uid: string, user: UserProfile): boolean {
  if (isExcludedTestLead(uid, user)) return true;
  if (user.isTest === true || user.testAccount === true) return true;
  if (typeof user.accountType === 'string' && user.accountType.trim().toLowerCase() === 'test') return true;
  if (uid.startsWith('user-test-')) return true;
  const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
  return email.endsWith('@test.com');
}

/** Env wins. The stored adminSettings value is used only when env is unset. */
export function selectWebhookUrl(envValue: string | undefined, stored: unknown): string | null {
  const fromEnv = typeof envValue === 'string' ? envValue.trim() : '';
  if (fromEnv) return fromEnv;
  if (typeof stored === 'string' && stored.trim()) return stored.trim();
  return null;
}

export async function resolveDiscordWebhookUrl(deps: {
  envValue: string | undefined;
  readStoredWebhook: () => Promise<unknown>;
}): Promise<string | null> {
  if (typeof deps.envValue === 'string' && deps.envValue.trim()) {
    return selectWebhookUrl(deps.envValue, null);
  }
  return selectWebhookUrl(undefined, await deps.readStoredWebhook());
}

const DISCORD_WEBHOOK_HOSTS = new Set([
  'discord.com',
  'canary.discord.com',
  'ptb.discord.com',
  'discordapp.com',
  'canary.discordapp.com',
  'ptb.discordapp.com',
]);

function isDiscordWebhookHost(hostname: string): boolean {
  return DISCORD_WEBHOOK_HOSTS.has(hostname);
}

export function isDiscordWebhookUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password || url.port) return false;
  if (url.search || url.hash) return false;
  const host = url.hostname.toLowerCase();
  if (!isDiscordWebhookHost(host)) return false;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 4) return false;
  if (parts[0] !== 'api' || parts[1] !== 'webhooks') return false;
  if (!/^\d{5,30}$/.test(parts[2])) return false;
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(parts[3])) return false;
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredLine(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function optionalLine(value: unknown, max: number): string | undefined | null {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\u0000/g, '').trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) return null;
  return trimmed;
}

function optionalNumber(value: unknown, max: number): number | undefined | null {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) return null;
  return value;
}

function optionalBill(value: unknown): string | undefined | null {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return null;
    return String(value);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^[0-9]{1,7}(\.[0-9]{1,2})?$/.test(trimmed)) return null;
  return trimmed;
}

export function parseNotificationPayload(body: unknown): ParsedNotification {
  if (!isPlainObject(body)) return { ok: false, error: 'Invalid notification.' };

  if (body.kind === 'test') {
    if (Object.keys(body).length !== 1) return { ok: false, error: 'Invalid notification.' };
    return { ok: true, kind: 'test' };
  }

  if (body.kind !== 'scheduling') return { ok: false, error: 'Invalid notification.' };

  for (const key of Object.keys(body)) {
    if (!SCHEDULING_KEYS.has(key)) return { ok: false, error: 'Invalid notification.' };
  }

  const name = requiredLine(body.name, 120);
  const address = requiredLine(body.address, 200);
  const city = requiredLine(body.city, 80);
  const stateRaw = requiredLine(body.state, 2);
  const zip = requiredLine(body.zip, 10);
  const phone = requiredLine(body.phone, 40);
  if (!name) return { ok: false, error: 'Name is required.' };
  if (!address) return { ok: false, error: 'Street address is required.' };
  if (!city) return { ok: false, error: 'City is required.' };
  if (!stateRaw || !/^[A-Za-z]{2}$/.test(stateRaw)) return { ok: false, error: 'State is required.' };
  if (!zip || !/^\d{5}(-\d{4})?$/.test(zip)) return { ok: false, error: 'ZIP code is required.' };
  if (!phone) return { ok: false, error: 'Phone is required.' };

  const email = optionalLine(body.email, 120);
  if (email === null) return { ok: false, error: 'Invalid notification.' };
  const notes = optionalLine(body.notes, 800);
  if (notes === null) return { ok: false, error: 'Invalid notification.' };
  const estimatedBill = optionalBill(body.estimatedBill);
  if (estimatedBill === null) return { ok: false, error: 'Invalid notification.' };
  const solarScore = optionalNumber(body.solarScore, 100);
  const solarSunshineHours = optionalNumber(body.solarSunshineHours, 100_000);
  const solarMaxPanels = optionalNumber(body.solarMaxPanels, 100_000);
  if (solarScore === null || solarSunshineHours === null || solarMaxPanels === null) {
    return { ok: false, error: 'Invalid notification.' };
  }
  let hasSouthFacingRoof: boolean | undefined;
  if (body.hasSouthFacingRoof == null || body.hasSouthFacingRoof === '') {
    hasSouthFacingRoof = undefined;
  } else if (typeof body.hasSouthFacingRoof === 'boolean') {
    hasSouthFacingRoof = body.hasSouthFacingRoof;
  } else {
    return { ok: false, error: 'Invalid notification.' };
  }

  return {
    ok: true,
    kind: 'scheduling',
    fields: {
      name,
      address,
      city,
      state: stateRaw.toUpperCase(),
      zip,
      phone,
      email,
      estimatedBill,
      notes,
      solarScore,
      solarSunshineHours,
      solarMaxPanels,
      hasSouthFacingRoof,
    },
  };
}

function neutralizeMentions(value: string): string {
  return value.replace(/@(everyone|here)/gi, '@\u200b$1');
}

export function buildSchedulingContent(fields: SchedulingFields, senderName: string): string {
  const sender = neutralizeMentions(senderName.replace(/[\u0000-\u001F\u007F]/g, ' ').trim()).slice(0, 80)
    || 'Unknown Setter';

  let solar = '';
  if (typeof fields.solarScore === 'number') {
    const hours = typeof fields.solarSunshineHours === 'number'
      ? Math.round(fields.solarSunshineHours).toLocaleString('en-US')
      : 'N/A';
    const panels = typeof fields.solarMaxPanels === 'number' ? String(fields.solarMaxPanels) : 'N/A';
    const south = typeof fields.hasSouthFacingRoof === 'boolean'
      ? (fields.hasSouthFacingRoof ? 'Yes ✅' : 'No ❌')
      : 'N/A';
    solar = `\n**☀️ Solar Data:**\n- Solar Score: ${fields.solarScore}/100\n- Sun Hours/Year: ${hours}\n- Max Panels: ${panels}\n- South-Facing Roof: ${south}`;
  }

  const bill = fields.estimatedBill ? `$${fields.estimatedBill}/mo` : 'N/A';
  const email = fields.email ? neutralizeMentions(fields.email) : 'N/A';
  const notes = fields.notes ? neutralizeMentions(fields.notes) : 'None';

  return [
    '📞 **Scheduling Manager Request**',
    `👤 **Sent by:** ${sender}`,
    '',
    '**Lead Details:**',
    `👤 Name: ${neutralizeMentions(fields.name)}`,
    `📍 Address: ${neutralizeMentions(fields.address)}, ${neutralizeMentions(fields.city)}, ${fields.state} ${fields.zip}`,
    `📞 Phone: ${fields.phone}`,
    `📧 Email: ${email}`,
    `💰 Est. Bill: ${bill}${solar}`,
    '',
    `📝 Notes: ${notes}`,
    '',
    '🎯 **Action Required:** Call customer to schedule appointment',
  ].join('\n');
}

export function discordPostBody(content: string): DiscordPostBody {
  return { content, allowed_mentions: { parse: [] } };
}

export async function postDiscordWebhook(url: string, body: DiscordPostBody): Promise<{ ok: boolean; status: number }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function handleDiscordNotification(input: {
  authorization: string | null;
  body: unknown;
  deps: DiscordNotificationDeps;
}): Promise<{ status: number; body: { error?: string; success?: boolean }; headers?: Record<string, string> }> {
  let approved;
  try {
    approved = await requireApprovedUser(input.authorization, input.deps);
  } catch (error) {
    if (error instanceof HttpError) {
      return { status: error.status, body: { error: error.message } };
    }
    throw error;
  }

  if (isTestAccount(approved.uid, approved.user)) {
    return { status: 403, body: { error: 'Test accounts cannot send notifications.' } };
  }

  const parsed = parseNotificationPayload(input.body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

  if (parsed.kind === 'test' && approved.role !== 'admin') {
    return { status: 403, body: { error: 'Only an admin can send a test notification.' } };
  }

  const now = input.deps.now?.() ?? Date.now();
  const store = input.deps.rateLimitStore ?? HITS;
  if (!allowDiscordNotification(approved.uid, now, store)) {
    return {
      status: 429,
      body: { error: 'Too many notifications. Try again in a minute.' },
      headers: { 'Retry-After': String(discordRetryAfterSeconds(approved.uid, now, store)) },
    };
  }

  const webhookUrl = await input.deps.resolveWebhookUrl();
  if (!webhookUrl || !isDiscordWebhookUrl(webhookUrl)) {
    return { status: 503, body: { error: 'Discord notifications are not configured.' } };
  }

  const sender = typeof approved.user.name === 'string' ? approved.user.name : '';
  const content = parsed.kind === 'test'
    ? DISCORD_TEST_CONTENT
    : buildSchedulingContent(parsed.fields, sender);

  if (content.length > DISCORD_CONTENT_MAX) {
    return { status: 400, body: { error: 'Notification is too long.' } };
  }

  const posted = await input.deps.postDiscord(webhookUrl, discordPostBody(content));
  if (!posted.ok) {
    return { status: 502, body: { error: 'Discord did not accept the notification.' } };
  }
  return { status: 200, body: { success: true } };
}
