import type { Lead } from "@/app/types";
import { isCountedKnock, knockInstant } from "@/app/utils/knockCount";

/**
 * Client view of PR A (#187 @47b0b91) and the Exp. Go-Back display from PR B (#188).
 * Every new field is optional. Ownership mode 'legacy' or a missing mode keeps
 * today's behavior. Nothing here reads Firestore.
 */

export type OwnerName = { uid: string; name: string | null };

export const EXP_GO_BACK = {
  id: "exp-go-back",
  label: "Exp. Go-Back",
  color: "#a16207",
  icon: "\u21ba",
} as const;

export const TERRITORY_WARNING =
  "Warning: You are in another user's territory. Do you wish to place this pin?";

export const KNOCK_COUNTED_EVENT = "raydar:knock-counted";
export const KNOCK_EVENT_CAP = 500;
const OWNERS_MAX = 5;

export const OWNERSHIP_ROW_KEYS = [
  "ownedByMe",
  "owners",
  "ownerSource",
  "expiredGoBack",
  "inOtherUsersTerritory",
] as const;

export type CountedOnlyBody = {
  countedOnly: true;
  duplicate: boolean;
  owner: OwnerName | null;
  owners: OwnerName[];
  eventId?: string;
  actionAt?: string;
};

export type ParsedKnockEvent = {
  leadId: string;
  userId: string;
  dispositionId: string;
  at: number;
};

type Meta = { ownership: "legacy" | "territory"; popupExempt: boolean };
const sessions = new Map<string, Meta>();
const toasted = new Set<string>();

export function resetOwnerCountsForTests(): void {
  sessions.clear();
  toasted.clear();
}

function parseOwner(value: unknown): OwnerName | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { uid?: unknown; name?: unknown };
  if (typeof row.uid !== "string" || !row.uid.trim()) return null;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 80) : null;
  return { uid: row.uid, name };
}

/** HTTP 200 result counted_only. Absent or any other result returns null. */
export function readCountedOnly(data: unknown): CountedOnlyBody | null {
  if (!data || typeof data !== "object") return null;
  const row = data as {
    result?: unknown;
    duplicate?: unknown;
    owner?: unknown;
    owners?: unknown;
    eventId?: unknown;
    actionAt?: unknown;
  };
  if (row.result !== "counted_only") return null;
  const owners = Array.isArray(row.owners)
    ? row.owners.map(parseOwner).filter((item): item is OwnerName => item !== null).slice(0, OWNERS_MAX)
    : [];
  const owner = parseOwner(row.owner) ?? owners[0] ?? null;
  return {
    countedOnly: true,
    duplicate: row.duplicate === true,
    owner,
    owners,
    ...(typeof row.eventId === "string" && row.eventId ? { eventId: row.eventId } : {}),
    ...(typeof row.actionAt === "string" && row.actionAt ? { actionAt: row.actionAt } : {}),
  };
}

/** owner null → "Counted." Several owners → "Name +N". Names only, never uids. */
export function countedToastText(
  owner: OwnerName | null | undefined,
  owners?: readonly OwnerName[] | null,
): string {
  if (owner == null) return "Counted.";
  const first = typeof owner.name === "string" ? owner.name.trim() : "";
  if (!first) return "Counted. This pin belongs to another rep.";
  const extra = Array.isArray(owners) ? owners.length : 0;
  if (extra > 1) return `Counted. This pin belongs to ${first} +${extra - 1}`;
  return `Counted. This pin belongs to ${first}`;
}

/** True the first time this draft should toast this session, including a duplicate replay. */
export function takeCountedToast(draftId: string, _duplicate = false): boolean {
  if (!draftId || toasted.has(draftId)) return false;
  toasted.add(draftId);
  return true;
}

/** Same fallback key knockCount derives. `at` must already be epoch ms. */
export function countedLedgerKey(
  leadId: string,
  userId: string,
  dispositionId: string,
  at: number,
): string {
  return `${leadId}|${userId}|${dispositionId}|${at}`;
}

/** ISO (counted_only actionAt) and epoch ms (knockEvents at) both become ms. */
export function actionEpochMs(value: unknown): number | null {
  return knockInstant(value);
}

/**
 * First personal page shape: {leadId, at, dispositionId}. A foreign userId is ignored.
 * Non-arrays, bad times, and excluded dispositions are dropped. Past the cap is dropped.
 */
export function parseMobileKnockEvents(raw: unknown, userId: string): ParsedKnockEvent[] {
  if (!userId || !Array.isArray(raw)) return [];
  const out: ParsedKnockEvent[] = [];
  const limit = Math.min(raw.length, KNOCK_EVENT_CAP);
  for (let index = 0; index < limit; index += 1) {
    const item = raw[index];
    if (!item || typeof item !== "object") continue;
    const row = item as { leadId?: unknown; at?: unknown; dispositionId?: unknown; userId?: unknown };
    if (typeof row.userId === "string" && row.userId !== userId) continue;
    if (typeof row.leadId !== "string" || !row.leadId.trim()) continue;
    if (typeof row.dispositionId !== "string" || !row.dispositionId.trim()) continue;
    const at = knockInstant(row.at);
    if (at == null) continue;
    if (!isCountedKnock(row.dispositionId)) continue;
    out.push({ leadId: row.leadId, userId, dispositionId: row.dispositionId, at });
  }
  return out;
}

export function noteMobileLeadsMeta(uid: string, data: unknown): void {
  if (!uid || !data || typeof data !== "object") return;
  const row = data as { ownership?: unknown; popupExempt?: unknown };
  if (row.ownership !== "legacy" && row.ownership !== "territory") return;
  sessions.set(uid, { ownership: row.ownership, popupExempt: row.popupExempt === true });
}

export function territoryOwnershipOn(uid: string | null | undefined): boolean {
  return !!uid && sessions.get(uid)?.ownership === "territory";
}

export function callerPopupExempt(uid: string | null | undefined): boolean {
  return !!uid && sessions.get(uid)?.popupExempt === true;
}

/** Territory mode keeps the row flags. Legacy or a missing mode strips them. */
export function rowsForOwnership<T extends object>(uid: string, data: unknown): T[] {
  noteMobileLeadsMeta(uid, data);
  const record = data && typeof data === "object" ? data as { leads?: unknown; ownership?: unknown } : {};
  const leads = Array.isArray(record.leads) ? record.leads as T[] : [];
  if (record.ownership === "territory") return leads;
  return leads.map((lead) => {
    if (!lead || typeof lead !== "object") return lead;
    let copy: T | null = null;
    for (const key of OWNERSHIP_ROW_KEYS) {
      if (key in lead) {
        copy ??= { ...lead };
        delete (copy as Record<string, unknown>)[key];
      }
    }
    return copy ?? lead;
  });
}

export function ownershipBadge(lead: Pick<Lead, "ownedByMe" | "owners"> | null | undefined): string | null {
  if (!lead || lead.ownedByMe !== false) return null;
  const names = (Array.isArray(lead.owners) ? lead.owners : [])
    .map((owner) => (typeof owner?.name === "string" ? owner.name.trim() : ""))
    .filter(Boolean);
  if (names.length === 0) return "Owned by another rep";
  if (names.length === 1) return `Owned by ${names[0]}`;
  return `Owned by ${names[0]} +${names.length - 1}`;
}

/** ownedByMe true is mine even when another rep is also an owner. Absent keeps claimedBy. */
export function pinIsMine(
  lead: Pick<Lead, "claimedBy" | "ownedByMe"> | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!userId || !lead) return false;
  if (lead.ownedByMe === true) return true;
  return lead.claimedBy === userId;
}

export function shouldWarnTerritory(input: {
  active: boolean;
  popupExempt: boolean;
  row?: { inOtherUsersTerritory?: boolean; ownedByMe?: boolean } | null;
}): boolean {
  if (!input.active || input.popupExempt) return false;
  if (!input.row || input.row.ownedByMe === true) return false;
  return input.row.inOtherUsersTerritory === true;
}

export function territoryWarningCancelled(): Error {
  return Object.assign(Error("territory-warning-cancelled"), { code: "territory-warning-cancelled" });
}

export function isTerritoryWarningCancelled(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "territory-warning-cancelled";
}

export function selectableDispositions<T extends { id: string }>(list: readonly T[]): T[] {
  return list.filter((row) => row.id !== EXP_GO_BACK.id);
}

/** A row already loaded for this coordinate. No polygon math. No row means no warning. */
export function leadAtPoint<T extends { lat?: number; lng?: number }>(
  leads: readonly T[],
  lat?: number,
  lng?: number,
): T | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return leads.find((lead) => lead.lat === lat && lead.lng === lng) ?? null;
}
