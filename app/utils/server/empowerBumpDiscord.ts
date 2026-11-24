// "Empower Plus bump" Discord post, sent by POST /api/empower-bump to the
// SCHEDULING MANAGER channel (Evan, Nov 23 2026). This route is the only poster.
//
// Destination, in order:
// 1. DISCORD_EMPOWER_BUMP_WEBHOOK_URL (optional override; the preview/test path).
//    When set it wins, and if it is invalid nothing is posted (no fallback).
// 2. The scheduling-manager webhook, resolved exactly like
//    POST /api/notifications/discord: DISCORD_NOTIFICATION_WEBHOOK_URL env, else
//    Firestore adminSettings/global.notificationWebhook (Raydar default DB).
// Never DISCORD_OPPORTUNITY_WEBHOOK_URL or the FMA channel. Neither configured
// (or invalid): the event stays pending and only a status is logged.
// Webhook URLs are never logged or returned.

import { isDiscordWebhookUrl, resolveDiscordWebhookUrl } from './discordNotification';
import { neutralizeMentions } from './empowerBumpContract';
import type { EmpowerBumpEvent } from './empowerBumpStore';

export const EMPOWER_BUMP_TITLE = 'Empower Plus bump';
export const EMPOWER_BUMP_COLOR = 0x2eb67d;
const ESTIMATED_TIER_LABELS = new Set(['Tier 1 (est.)', 'Tier 3 (est.)', 'Comfort Home (est.)', 'Not sure']);

export type WebhookSource = 'override' | 'scheduling_manager';
export type WebhookResolution =
  | { url: string; source: WebhookSource }
  | { url: null; reason: 'not_configured' | 'invalid_override' | 'invalid_scheduling_webhook' };

export async function resolveEmpowerBumpWebhook(input: {
  overrideValue: string | undefined;
  schedulingEnvValue: string | undefined;
  readStoredSchedulingWebhook: () => Promise<unknown>;
}): Promise<WebhookResolution> {
  const override = typeof input.overrideValue === 'string' ? input.overrideValue.trim() : '';
  if (override) {
    return isDiscordWebhookUrl(override) ? { url: override, source: 'override' } : { url: null, reason: 'invalid_override' };
  }
  const scheduling = await resolveDiscordWebhookUrl({
    envValue: input.schedulingEnvValue,
    readStoredWebhook: input.readStoredSchedulingWebhook,
  });
  if (!scheduling) return { url: null, reason: 'not_configured' };
  return isDiscordWebhookUrl(scheduling)
    ? { url: scheduling, source: 'scheduling_manager' }
    : { url: null, reason: 'invalid_scheduling_webhook' };
}

/** For any diagnostic that must reference a webhook: host and id prefix only, never the token. */
export function maskWebhookUrl(value: string): string {
  try {
    const url = new URL(value);
    const id = url.pathname.split('/').filter(Boolean)[2] ?? '';
    return `${url.hostname}/api/webhooks/${id.slice(0, 4)}…`;
  } catch {
    return '(invalid)';
  }
}

function clean(value: unknown, max: number, fallback: string): string {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  const safe = neutralizeMentions(text).replace(/<@/g, '<\u200b@').slice(0, max);
  return safe || fallback;
}

export type EmpowerBumpDiscordBody = {
  content: string;
  embeds: Array<{
    title: string;
    color: number;
    fields: Array<{ name: string; value: string; inline: boolean }>;
    footer: { text: string };
    timestamp: string;
  }>;
  allowed_mentions: { parse: string[] };
};

/** Agreed fields only. No phone, email, address, or dollars. */
export function buildEmpowerBumpDiscordBody(event: EmpowerBumpEvent, nowMs: number): EmpowerBumpDiscordBody {
  const tier = ESTIMATED_TIER_LABELS.has(event.estimatedTierLabel) ? event.estimatedTierLabel : 'Not sure';
  const household = Number.isInteger(event.householdSize) && event.householdSize >= 1 && event.householdSize <= 10
    ? String(event.householdSize)
    : 'Unknown';
  return {
    content: EMPOWER_BUMP_TITLE,
    embeds: [{
      title: EMPOWER_BUMP_TITLE,
      color: EMPOWER_BUMP_COLOR,
      fields: [
        { name: 'Customer', value: clean(event.name, 120, 'Unknown'), inline: true },
        { name: 'Town', value: clean(event.town, 80, 'Unknown'), inline: true },
        { name: 'Rep', value: clean(event.repName, 80, 'Unknown Rep'), inline: true },
        { name: 'Household size', value: household, inline: true },
        { name: 'Estimated tier', value: tier, inline: true },
        { name: 'Government assistance', value: event.assistanceYes === true ? 'Yes' : 'No', inline: true },
      ],
      footer: { text: `Opportunity ID: ${clean(event.opportunityId, 64, '')}` },
      timestamp: new Date(nowMs).toISOString(),
    }],
    allowed_mentions: { parse: [] },
  };
}

export type DiscordFetch = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
  redirect: 'error';
  signal: AbortSignal;
}) => Promise<{ ok: boolean; status: number }>;

export function createEmpowerBumpDiscordPoster(fetchImpl: DiscordFetch) {
  return async (url: string, body: EmpowerBumpDiscordBody): Promise<{ ok: boolean; status: number }> => {
    if (!isDiscordWebhookUrl(url)) return { ok: false, status: 0 };
    try {
      const response = await fetchImpl(url, {
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
  };
}
