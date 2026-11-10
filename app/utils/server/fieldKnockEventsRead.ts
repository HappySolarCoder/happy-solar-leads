import { knockEventFromDoc } from '@/app/utils/fieldKnockEvents';
import { HttpError, requireApprovedUser, type RequireApprovedUserDeps } from './requireApprovedUser';

/**
 * GET /api/field-knock-events?since=<epoch ms>
 * Web dashboards read counts-only knocks here (the collection is closed to
 * every client). Admin and manager get everyone in the window (one range read
 * on actionAt, single-field index, limit 3000). Everyone else gets only their
 * own rows (doc-id range `{uid}_`, limit 600). Excluded dispositions (Shade DQ,
 * Already Has Solar) are dropped. Read-only.
 */
export const FIELD_EVENTS_STAFF_LIMIT = 3000;
export const FIELD_EVENTS_OWN_LIMIT = 600;
export const FIELD_EVENTS_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

export type FieldEventsDeps = RequireApprovedUserDeps & {
  now?: () => number;
  loadSince: (sinceMs: number, limit: number) => Promise<Array<Record<string, unknown>>>;
  loadOwn: (uid: string, limit: number) => Promise<Array<Record<string, unknown>>>;
};

export async function handleFieldKnockEventsGet(input: {
  authorization: string | null;
  sinceParam: string | null;
  deps: FieldEventsDeps;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  let approved;
  try {
    approved = await requireApprovedUser(input.authorization, input.deps);
  } catch (error) {
    if (error instanceof HttpError) {
      return { status: error.status === 401 ? 401 : 403, body: { error: error.status === 401 ? 'unauthenticated' : 'forbidden' } };
    }
    throw error;
  }
  const now = input.deps.now?.() ?? Date.now();
  const floor = now - FIELD_EVENTS_MAX_AGE_MS;
  const parsed = input.sinceParam == null || input.sinceParam === '' ? floor : Number(input.sinceParam);
  if (!Number.isFinite(parsed)) return { status: 400, body: { error: 'invalid_since' } };
  const sinceMs = Math.max(floor, parsed);
  const staff = approved.role === 'admin' || approved.role === 'manager';
  const rows = staff
    ? await input.deps.loadSince(sinceMs, FIELD_EVENTS_STAFF_LIMIT)
    : await input.deps.loadOwn(approved.uid, FIELD_EVENTS_OWN_LIMIT);
  const events: Array<{ uid: string; leadId: string; at: number; dispositionId: string }> = [];
  for (const row of rows) {
    const event = knockEventFromDoc(row);
    if (!event || event.at < sinceMs) continue;
    if (!staff && event.userId !== approved.uid) continue;
    events.push({ uid: event.userId, leadId: event.leadId, at: event.at, dispositionId: event.dispositionId });
  }
  events.sort((a, b) => b.at - a.at);
  return { status: 200, body: { events, scope: staff ? 'all' : 'own' } };
}
