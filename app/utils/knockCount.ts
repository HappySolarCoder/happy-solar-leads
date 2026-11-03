import type { Lead } from "@/app/types";
import type { Disposition } from "@/app/types/disposition";

/** Shade DQ and Has Solar / Already Has Solar never count. */
export const EXCLUDED_KNOCK_KEYS = new Set([
  "shade-dq",
  "has-solar",
  "already-has-solar",
]);

/** Ownership and unworked states. Same set as house identity. */
export const NON_KNOCK_KEYS = new Set([
  "",
  "assigned",
  "unassigned",
  "unclaimed",
  "claimed",
  "new",
  "not-knocked",
  "available",
  "my-targets",
]);

export type KnockEvent = {
  key: string;
  leadId: string;
  userId: string;
  at: number;
  dispositionId: string;
};

export type KnockCountOptions = {
  userId?: string;
  /** Inclusive. */
  start?: Date;
  /** Exclusive. */
  end?: Date;
  /** Device-local events unioned with loaded leads. A shorter lead list cannot drop these. */
  ledger?: readonly KnockEvent[];
  /**
   * Hot pin id → promoted lead id. Events on either id with the same rep, disposition,
   * and time count once. Without an alias or a shared eventId, a promoted lead that
   * received a new id is a different door and is not merged.
   */
  leadAliases?: ReadonlyArray<readonly [string, string]>;
};

type HistoryLike = {
  disposition?: unknown;
  timestamp?: unknown;
  userId?: unknown;
  field?: { eventId?: unknown };
};

type RawEvent = {
  eventId?: string;
  leadId: string;
  userId: string;
  at: number;
  dispositionId: string;
};

export function dispositionSlug(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

/** Id match, otherwise name match. Otherwise the normalized raw value. */
export function normalizeDispoKey(
  raw: unknown,
  dispositions: readonly Disposition[],
): string {
  const key = dispositionSlug(raw);
  for (const row of dispositions) {
    if (row && dispositionSlug(row.id) === key) return row.id;
  }
  for (const row of dispositions) {
    if (row && dispositionSlug(row.name) === key) return row.id;
  }
  return key;
}

/** Evan's gate. Config resolves names; it does not decide whether a knock counts. */
export function isCountedKnock(dispositionId: string): boolean {
  const key = dispositionSlug(dispositionId);
  return !EXCLUDED_KNOCK_KEYS.has(key) && !NON_KNOCK_KEYS.has(key);
}

/** Timestamp, Date, ISO string, or {seconds,nanoseconds}. Invalid values are null. */
export function knockInstant(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value !== "object") return null;
  const stamp = value as {
    toMillis?: () => number;
    toDate?: () => Date;
    seconds?: unknown;
    nanoseconds?: unknown;
    _seconds?: unknown;
    _nanoseconds?: unknown;
  };
  if (typeof stamp.toMillis === "function") {
    try {
      const time = stamp.toMillis();
      return typeof time === "number" && Number.isFinite(time) ? time : null;
    } catch {
      return null;
    }
  }
  if (typeof stamp.toDate === "function") {
    try {
      const date = stamp.toDate();
      const time = date instanceof Date ? date.getTime() : NaN;
      return Number.isFinite(time) ? time : null;
    } catch {
      return null;
    }
  }
  const seconds =
    typeof stamp.seconds === "number"
      ? stamp.seconds
      : typeof stamp._seconds === "number"
        ? stamp._seconds
        : null;
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const nanos =
    typeof stamp.nanoseconds === "number"
      ? stamp.nanoseconds
      : typeof stamp._nanoseconds === "number"
        ? stamp._nanoseconds
        : 0;
  if (!Number.isFinite(nanos)) return null;
  const time = seconds * 1000 + nanos / 1e6;
  return Number.isFinite(time) ? time : null;
}

function actorId(lead: Lead): string {
  const claimed = typeof lead.claimedBy === "string" ? lead.claimedBy.trim() : "";
  if (claimed) return claimed;
  return typeof lead.assignedTo === "string" ? lead.assignedTo.trim() : "";
}

function eventIdOf(field: unknown): string | undefined {
  if (!field || typeof field !== "object") return undefined;
  const id = (field as { eventId?: unknown }).eventId;
  return typeof id === "string" && id && !id.includes("|") ? id : undefined;
}

function rawFromHistory(
  leadId: string,
  entry: HistoryLike,
  dispositions: readonly Disposition[],
): RawEvent | null {
  const userId = typeof entry.userId === "string" ? entry.userId.trim() : "";
  if (!userId) return null;
  const at = knockInstant(entry.timestamp);
  if (at == null) return null;
  const dispositionId = normalizeDispoKey(entry.disposition, dispositions);
  if (!isCountedKnock(dispositionId)) return null;
  return {
    eventId: eventIdOf(entry.field),
    leadId,
    userId,
    at,
    dispositionId,
  };
}

function legacyRaw(
  lead: Lead,
  dispositions: readonly Disposition[],
): RawEvent | null {
  const userId = actorId(lead);
  if (!userId) return null;
  const at = knockInstant(lead.dispositionedAt);
  if (at == null) return null;
  const recorded = lead as Lead & { dispositionId?: unknown };
  const dispositionId = normalizeDispoKey(
    recorded.dispositionId || lead.status || lead.disposition,
    dispositions,
  );
  if (!isCountedKnock(dispositionId)) return null;
  return { leadId: lead.id, userId, at, dispositionId };
}

/** One event per history entry. Legacy status is used only when history is empty. */
export function knockEvents(
  lead: Lead,
  dispositions: readonly Disposition[],
): KnockEvent[] {
  return dedupe(rawEvents(lead, dispositions)).map(toKnockEvent);
}

function rawEvents(
  lead: Lead,
  dispositions: readonly Disposition[],
): RawEvent[] {
  if (!lead?.id) return [];
  const history = (lead.dispositionHistory || []) as HistoryLike[];
  if (history.length > 0) {
    return history.flatMap((entry) => {
      const raw = rawFromHistory(lead.id, entry, dispositions);
      return raw ? [raw] : [];
    });
  }
  const legacy = legacyRaw(lead, dispositions);
  return legacy ? [legacy] : [];
}

function aliasMap(
  pairs: ReadonlyArray<readonly [string, string]> | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [from, to] of pairs || []) {
    if (from && to && from !== to) map.set(from, to);
  }
  return map;
}

function canonicalLeadId(id: string, aliases: Map<string, string>): string {
  return aliases.get(id) || id;
}

function fallbackKey(event: RawEvent): string {
  return `${event.leadId}|${event.userId}|${event.dispositionId}|${event.at}`;
}

function toKnockEvent(event: RawEvent): KnockEvent {
  return {
    key: event.eventId || fallbackKey(event),
    leadId: event.leadId,
    userId: event.userId,
    at: event.at,
    dispositionId: event.dispositionId,
  };
}

/**
 * Same eventId collapses across leads. Otherwise the identity is
 * lead + rep + disposition + time, matching mergeReportingPatch.
 * A fallback key always contains "|"; an eventId never does.
 */
function dedupe(events: RawEvent[]): RawEvent[] {
  const seenIds = new Set<string>();
  const seenFallback = new Set<string>();
  const kept: RawEvent[] = [];
  for (const event of events) {
    const fallback = fallbackKey(event);
    if (event.eventId && seenIds.has(event.eventId)) continue;
    if (seenFallback.has(fallback)) continue;
    if (event.eventId) seenIds.add(event.eventId);
    seenFallback.add(fallback);
    kept.push(event);
  }
  return kept;
}

function ledgerRaw(event: KnockEvent): RawEvent {
  const eventId = event.key.includes("|") ? undefined : event.key;
  return {
    eventId,
    leadId: event.leadId,
    userId: event.userId,
    at: event.at,
    dispositionId: event.dispositionId,
  };
}

function inWindow(at: number, opts: KnockCountOptions): boolean {
  const start = opts.start?.getTime();
  const end = opts.end?.getTime();
  if (typeof start === "number" && Number.isFinite(start) && at < start) return false;
  if (typeof end === "number" && Number.isFinite(end) && at >= end) return false;
  return true;
}

/** Union of every snapshot and ledger row. A shorter snapshot cannot remove an event. */
export function collectKnockEvents(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
  opts: KnockCountOptions = {},
): KnockEvent[] {
  const aliases = aliasMap(opts.leadAliases);
  const raw: RawEvent[] = [];
  for (const lead of leads) {
    for (const event of rawEvents(lead, dispositions)) {
      raw.push({ ...event, leadId: canonicalLeadId(event.leadId, aliases) });
    }
  }
  for (const event of opts.ledger || []) {
    const row = ledgerRaw(event);
    raw.push({ ...row, leadId: canonicalLeadId(row.leadId, aliases) });
  }
  return dedupe(raw).map(toKnockEvent);
}

function selected(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
  opts: KnockCountOptions,
): KnockEvent[] {
  return collectKnockEvents(leads, dispositions, opts).filter(
    (event) =>
      (opts.userId === undefined || event.userId === opts.userId) &&
      inWindow(event.at, opts),
  );
}

export function countKnocks(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
  opts: KnockCountOptions = {},
): number {
  return selected(leads, dispositions, opts).length;
}

/** Device-local calendar day. Reporting's New York buckets are a separate decision. */
export function knockDayKey(at: number): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function knocksByDay(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
  opts: KnockCountOptions = {},
): Record<string, number> {
  const days: Record<string, number> = {};
  for (const event of selected(leads, dispositions, opts)) {
    const key = knockDayKey(event.at);
    days[key] = (days[key] || 0) + 1;
  }
  return days;
}

export function knocksByUser(
  leads: readonly Lead[],
  dispositions: readonly Disposition[],
  opts: KnockCountOptions = {},
): Record<string, number> {
  const users: Record<string, number> = {};
  for (const event of selected(leads, dispositions, opts)) {
    users[event.userId] = (users[event.userId] || 0) + 1;
  }
  return users;
}
