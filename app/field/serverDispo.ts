import type { Lead, User } from "@/app/types";
import { apiFetch } from "@/app/utils/apiFetch";
import { auth } from "@/app/utils/firebase";
import { commitDirectMutation, reportingPatch } from "./directWrites";
import { isGpsUnverifiedReason, validGpsMeters } from "./gpsPolicy";
import { FIELD_DISPO_UNAVAILABLE, SYNC_REASON, type SyncReasonCode } from "./syncReasons";
import type { PendingMutation } from "./types";

export const DRAFT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const FIELD_DISPO_PATH = "/api/field/dispo";
/** Slow retry while the route is not deployed. App start tries again immediately. */
export const SERVER_DISPO_SLOW_RETRY_MS = 15 * 60 * 1000;

const GPS_FIELDS = [
  "knockGpsLat",
  "knockGpsLng",
  "knockGpsAccuracy",
  "knockGpsTimestamp",
  "knockDistanceFromAddress",
] as const;
const GPS_FLAG_FIELDS = ["gpsVerified", "gpsUnverifiedReason", "gpsDistanceM"] as const;
const EXTRA_FIELDS = [
  "objectionType",
  "objectionNotes",
  "objectionRecordedAt",
  "objectionRecordedBy",
  "goBackScheduledDate",
  "goBackScheduledTime",
  "goBackNotes",
  "goBackScheduledBy",
] as const;

type DispoLead = Pick<Lead, "historicalTerritoryPin" | "claimedBy" | "assignedTo" | "setterId"> & {
  territoryId?: string;
};

/** Territory-API pins, and pins with no territory that this rep does not own or have assigned. */
export function prefersServerDispo(lead: DispoLead, uid: string): boolean {
  if (lead.historicalTerritoryPin) return true;
  const owned =
    lead.claimedBy === uid || lead.assignedTo === uid || lead.setterId === uid;
  if (owned) return false;
  return !lead.territoryId;
}

export function releaseFieldDispoHolds(drafts: PendingMutation[]): PendingMutation[] {
  return drafts.map((m) =>
    m.routeHold === "field-dispo" && m.syncState === "queued"
      ? { ...m, nextAttemptAt: undefined }
      : m,
  );
}

export type FieldDispoBody = {
  leadId: string;
  draftId: string;
  /** Original tap time. ISO-8601 string, never a Date or Timestamp. */
  actionAt: string;
  status?: string;
  disposition?: string;
  userId?: string;
  userName?: string;
  notes?: string;
  baseNotes?: string;
  dispositionHistory?: Array<{
    disposition: string;
    timestamp: string;
    userId: string;
    userName: string;
  }>;
  homeownerId?: string;
} & Partial<Record<(typeof GPS_FIELDS)[number] | (typeof EXTRA_FIELDS)[number], string | number>> & {
  gpsVerified?: boolean;
  gpsUnverifiedReason?: string;
  gpsDistanceM?: number;
};

const DATE_KEYS = new Set(["knockGpsTimestamp", "objectionRecordedAt", "goBackScheduledDate"]);

function isoString(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function knownReason(value: unknown): SyncReasonCode | undefined {
  return typeof value === "string" && (Object.values(SYNC_REASON) as string[]).includes(value)
    ? (value as SyncReasonCode)
    : undefined;
}

/** Photos and handoff are never included. draftId is the idempotency key. actionAt is ISO. */
export function fieldDispoBody(
  m: PendingMutation,
  user: User,
  patch?: Partial<Lead>,
): FieldDispoBody {
  if (m.kind === "handoff")
    throw Object.assign(Error("Handoffs are not sent to the disposition route."), {
      status: 400,
      reasonCode: SYNC_REASON.invalidPayload,
    });
  const sourcePatch = patch ?? reportingPatch(m, user);
  if (!DRAFT_ID_PATTERN.test(m.id))
    throw Object.assign(Error("Draft id is not a valid idempotency key."), {
      status: 400,
      reasonCode: SYNC_REASON.invalidPayload,
    });
  const actionAt = isoString(m.createdAt);
  if (!actionAt)
    throw Object.assign(Error("Invalid knock time. Check the device clock."), {
      status: 400,
      reasonCode: SYNC_REASON.invalidPayload,
    });
  if (m.kind === "notes") {
    return {
      leadId: m.leadId,
      draftId: m.id,
      actionAt,
      notes: m.notes ?? (typeof sourcePatch.notes === "string" ? sourcePatch.notes : ""),
      baseNotes: m.baseNotes ?? "",
      userId: m.userId,
      userName: m.userName || user.name,
    };
  }
  const own = reportingPatch(m, user).dispositionHistory?.[0];
  const body: FieldDispoBody = {
    leadId: m.leadId,
    draftId: m.id,
    actionAt,
    status: (sourcePatch.status as string | undefined) || m.status,
    disposition: own?.disposition || m.disposition || m.status,
    userId: m.userId,
    userName: own?.userName || m.userName || user.name,
    dispositionHistory: own
      ? [{
          disposition: own.disposition,
          timestamp: actionAt,
          userId: own.userId,
          userName: own.userName,
        }]
      : [],
  };
  const source = sourcePatch as Record<string, unknown>;
  for (const key of [...GPS_FIELDS, ...EXTRA_FIELDS]) {
    if (source[key] === undefined) continue;
    const value = DATE_KEYS.has(key) ? isoString(source[key]) : source[key];
    if (typeof value === "string" || typeof value === "number")
      (body as Record<string, unknown>)[key] = value;
  }
  if (typeof source.gpsVerified === "boolean") body.gpsVerified = source.gpsVerified;
  if (isGpsUnverifiedReason(source.gpsUnverifiedReason)) body.gpsUnverifiedReason = source.gpsUnverifiedReason;
  if (validGpsMeters(source.gpsDistanceM)) body.gpsDistanceM = source.gpsDistanceM;
  if (m.direct?.gpsPointSource === "homeowner_corrected" && m.direct.homeownerId)
    body.homeownerId = m.direct.homeownerId;
  return body;
}

export function patchCarriesGpsFlags(m: PendingMutation): boolean {
  const patch = m.direct?.patch as Record<string, unknown> | undefined;
  return !!patch && GPS_FLAG_FIELDS.some((key) => patch[key] !== undefined);
}

export function withoutGpsFlagKeys(m: PendingMutation): PendingMutation {
  if (!m.direct?.patch) return m;
  const patch = { ...m.direct.patch } as Record<string, unknown>;
  for (const key of GPS_FLAG_FIELDS) delete patch[key];
  return { ...m, direct: { ...m.direct, patch: patch as Partial<Lead> } };
}

export type FieldDispoDeps = {
  post?: (path: string, init: RequestInit) => Promise<Response>;
  getToken?: (forceRefresh?: boolean) => Promise<string>;
  commit?: (
    m: PendingMutation,
    user: User,
  ) => Promise<{ replayed: boolean; lead?: Lead }>;
};

async function readJson(response: Response): Promise<{
  currentNotes?: unknown;
  reasonCode?: unknown;
  lead?: Lead;
} | null> {
  try {
    return (await response.json()) as { currentNotes?: unknown; reasonCode?: unknown; lead?: Lead };
  } catch {
    return null;
  }
}

/** Retry-After seconds or HTTP-date. Capped at the 15 minute backoff ceiling. */
export function retryAfterDelayMs(header: string | null, now = Date.now()): number | undefined {
  if (header == null) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) return Math.min(15 * 60_000, Number(trimmed) * 1000);
  const when = Date.parse(trimmed);
  if (!Number.isFinite(when)) return undefined;
  return Math.min(15 * 60_000, Math.max(0, when - now));
}

function unavailable(): Error {
  return Object.assign(
    Error("The disposition route is not live yet. This knock stays queued."),
    { status: 404, code: FIELD_DISPO_UNAVAILABLE },
  );
}

function routeError(message: string, status: number, reasonCode: SyncReasonCode, retryAfterMs?: number) {
  return Object.assign(Error(message), { status, reasonCode, ...(retryAfterMs == null ? {} : { retryAfterMs }) });
}

export async function postFieldDispo(
  m: PendingMutation,
  user: User,
  deps: FieldDispoDeps = {},
): Promise<{ replayed: boolean; lead?: Lead }> {
  const post = deps.post ?? apiFetch;
  const getToken = deps.getToken ?? (async (forceRefresh = false) => {
    const current = auth?.currentUser;
    if (!current) return "";
    return current.getIdToken(forceRefresh);
  });
  const body = fieldDispoBody(m, user);
  let token = await getToken(false);
  if (!token) throw Error("Sign in again to sync your work.");
  let refreshed = false;
  let notesRetried = false;
  const send = (bearer: string) =>
    post(FIELD_DISPO_PATH, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  let response = await send(token);
  for (;;) {
    if (response.status === 401 && !refreshed) {
      refreshed = true;
      token = await getToken(true);
      if (!token) throw Object.assign(Error("Sign in again to sync your work."), { status: 401 });
      response = await send(token);
      continue;
    }
    if (response.status === 409 && !notesRetried) {
      const data = await readJson(response);
      const currentNotes = typeof data?.currentNotes === "string" ? data.currentNotes : "";
      if ((m.baseNotes || "") === currentNotes) {
        notesRetried = true;
        response = await send(token);
        continue;
      }
    }
    break;
  }
  if (response.status === 200 || response.status === 201) {
    const data = await readJson(response);
    return { replayed: false, lead: data?.lead };
  }
  if (response.status === 404) throw unavailable();
  if (response.status === 401)
    throw Object.assign(Error("Sign in again to sync your work."), { status: 401 });
  if (response.status === 410)
    throw routeError("This lead is gone.", 410, SYNC_REASON.notFound);
  if (response.status === 400 || response.status === 413)
    throw routeError("Disposition route rejected this knock.", response.status, SYNC_REASON.invalidPayload);
  if (response.status === 403) {
    const data = await readJson(response);
    throw routeError(
      "The disposition route denied this knock.",
      403,
      knownReason(data?.reasonCode) || SYNC_REASON.other,
    );
  }
  if (response.status === 409)
    throw routeError("Notes changed on another device. Review this draft.", 409, SYNC_REASON.notesConflict);
  if (response.status === 429)
    throw Object.assign(Error("Disposition route asked us to wait."), {
      status: 429,
      retryAfterMs: retryAfterDelayMs(response.headers.get("retry-after")),
    });
  if (response.status >= 500 || response.status === 408)
    throw Object.assign(Error("Disposition route unavailable."), { status: response.status });
  throw routeError("Disposition route rejected this knock.", response.status || 400, SYNC_REASON.invalidPayload);
}

function permissionDenied(error: Error & { status?: number; code?: string }): boolean {
  return error.code === "permission-denied";
}

/** Firestore first for owned leads. Notes keep the baseNotes check there. Handoffs never use this route. */
export async function deliverFieldDispo(
  m: PendingMutation,
  user: User,
  deps: FieldDispoDeps = {},
): Promise<{ replayed: boolean; lead?: Lead }> {
  const commit = deps.commit ?? commitDirectMutation;
  if (m.kind === "handoff") return commit(m, user);
  if (m.direct?.serverDispo) return postFieldDispo(m, user, deps);
  try {
    return await commit(m, user);
  } catch (error) {
    if (!permissionDenied(error as Error & { code?: string })) throw error;
    const carriedGps = patchCarriesGpsFlags(m);
    try {
      return await postFieldDispo(m, user, deps);
    } catch (routeError) {
      const denied = routeError as Error & { status?: number; code?: string };
      const missing = denied.code === FIELD_DISPO_UNAVAILABLE || denied.status === 404;
      if (carriedGps && missing) return commit(withoutGpsFlagKeys(m), user);
      throw routeError;
    }
  }
}
