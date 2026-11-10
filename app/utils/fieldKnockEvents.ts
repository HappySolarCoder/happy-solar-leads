import { dispositionSlug, isCountedKnock, knockInstant, type KnockEvent } from './knockCount';

/**
 * fieldKnockEvents/{uid}_{draftId}: a counts-only knock (see fieldDispo.ts).
 * These rows join the shared counter through knockCount's existing `ledger`
 * option, so knockCount.ts stays byte-identical across web, mobile and reporting.
 *
 * The ledger key is the FALLBACK key leadId|userId|dispositionId|atMs, never the
 * draft id. History entries carry no eventId, so a draft that is first
 * counted_only and later accepted (same actionAt) produces the same key from
 * both sources and counts once. The 120 s same-door collapse is the backstop.
 * `at` is the draft's original actionAt, never server time.
 */
export function knockLedgerKey(leadId: string, userId: string, dispositionId: string, at: number): string {
  return `${leadId}|${userId}|${dispositionId}|${at}`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** One event doc to a countable KnockEvent. Null when unusable or excluded (Shade DQ, Already Has Solar). */
export function knockEventFromDoc(data: Record<string, unknown> | undefined | null): KnockEvent | null {
  if (!data) return null;
  const userId = text(data.uid);
  const leadId = text(data.leadId);
  const at = knockInstant(data.actionAt);
  const dispositionId = dispositionSlug(data.dispositionId || data.status || data.disposition);
  if (!userId || !leadId || at == null || !dispositionId) return null;
  if (!isCountedKnock(dispositionId)) return null;
  return { key: knockLedgerKey(leadId, userId, dispositionId, at), leadId, userId, at, dispositionId };
}

/** Pass the result as `ledger` to collectKnockEvents / countKnocks / knocksByUser / knocksByDay. */
export function ledgerFromFieldEvents(rows: ReadonlyArray<Record<string, unknown> | undefined | null>): KnockEvent[] {
  const out: KnockEvent[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const event = knockEventFromDoc(row);
    if (!event || seen.has(event.key)) continue;
    seen.add(event.key);
    out.push(event);
  }
  return out;
}

/** Wire shape of /api/mobile-leads `knockEvents`: {leadId, at (epoch ms), dispositionId}. */
export type MobileKnockEvent = { leadId: string; at: number; dispositionId: string };

export function mobileKnockEvents(rows: ReadonlyArray<Record<string, unknown> | undefined | null>): MobileKnockEvent[] {
  return ledgerFromFieldEvents(rows).map(({ leadId, at, dispositionId }) => ({ leadId, at, dispositionId }));
}
