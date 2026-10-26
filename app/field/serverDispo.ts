import type { Lead, User } from "@/app/types";
import { apiFetch } from "@/app/utils/apiFetch";
import { auth } from "@/app/utils/firebase";
import { commitDirectMutation, reportingPatch } from "./directWrites";
import { recordSyncEvent, reportParked } from "./syncDiagnostics";
import { FIELD_DISPO_UNAVAILABLE, SYNC_REASON, type SyncReasonCode } from "./syncReasons";
import type { PendingMutation } from "./types";

export const DRAFT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const FIELD_DISPO_PATH = "/api/field/dispo";
/** Slow retry while the route is not deployed. App start tries again immediately. */
export const SERVER_DISPO_SLOW_RETRY_MS = 15 * 60 * 1000;

const GPS_FLAG_FIELDS = ["gpsVerified", "gpsUnverifiedReason", "gpsDistanceM"] as const;

type DispoLead = Pick<Lead, "historicalTerritoryPin" | "claimedBy" | "assignedTo" | "setterId"> & {
  territoryId?: string;
};

/**
 * Historical pins cannot be written from the client. Everything an admin could
 * write in 14.17 stays a direct write, including an unowned pin with no territory.
 * A rep still uses the route for an unowned pin with no territory, because the
 * client cannot read that lead in order to commit a transaction.
 */
export function prefersServerDispo(lead: DispoLead, uid: string, role?: string): boolean {
  if (lead.historicalTerritoryPin) return true;
  if (role === "admin") return false;
  const owned =
    lead.claimedBy === uid || lead.assignedTo === uid || lead.setterId === uid;
  if (owned) return false;
  return !lead.territoryId;
}

/** Keep the rep's edit and base the next attempt on the notes the server has now. */
export function rebaseNotes(baseNotes: string, edited: string, currentNotes: string): { notes: string; baseNotes: string } {
  const base = baseNotes || "";
  const current = currentNotes || "";
  const edit = edited || "";
  if (base && edit.startsWith(base)) {
    const addition = edit.slice(base.length);
    const notes = !addition || current.endsWith(addition) ? current : current + addition;
    return { notes, baseNotes: current };
  }
  return { notes: edit, baseNotes: current };
}

export function releaseFieldDispoHolds(drafts: PendingMutation[]): PendingMutation[] {
  return drafts.map((m) =>
    m.routeHold === "field-dispo" && m.syncState === "queued"
      ? { ...m, nextAttemptAt: undefined }
      : m,
  );
}

export type FieldDispoGps = {
  lat: number;
  lng: number;
  accuracyM: number;
  capturedAt: string;
};

/** Nested contract. The server derives the GPS verdict from `gps`. Flags never ride along. */
export type FieldDispoBody = {
  leadId: string;
  draftId: string;
  kind: "knock" | "notes";
  /** Original tap time. ISO-8601 UTC string, never a Date or Timestamp. */
  actionAt: string;
  status?: string;
  disposition?: string;
  userName?: string;
  notes?: string;
  baseNotes?: string | null;
  gps?: FieldDispoGps;
  goBack?: { scheduledDate: string; scheduledTime?: string; notes?: string };
  objection?: { type: string; notes?: string } | null;
  homeownerId?: string;
};

function isoString(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function knownReason(value: unknown): SyncReasonCode | undefined {
  return typeof value === "string" && (Object.values(SYNC_REASON) as string[]).includes(value)
    ? (value as SyncReasonCode)
    : undefined;
}

function invalid(message: string): Error {
  return Object.assign(Error(message), { status: 400, reasonCode: SYNC_REASON.invalidPayload });
}

function nestedGps(source: Record<string, unknown>): FieldDispoGps | undefined {
  const lat = finiteNumber(source.knockGpsLat);
  const lng = finiteNumber(source.knockGpsLng);
  const accuracyM = finiteNumber(source.knockGpsAccuracy);
  const capturedAt = isoString(source.knockGpsTimestamp);
  if (lat == null || lng == null || accuracyM == null || accuracyM < 0 || !capturedAt) return undefined;
  return { lat, lng, accuracyM, capturedAt };
}

function nestedGoBack(source: Record<string, unknown>): FieldDispoBody["goBack"] | undefined {
  const scheduledDate = isoString(source.goBackScheduledDate);
  if (!scheduledDate) return undefined;
  const goBack: NonNullable<FieldDispoBody["goBack"]> = { scheduledDate };
  if (typeof source.goBackScheduledTime === "string" && source.goBackScheduledTime) {
    goBack.scheduledTime = source.goBackScheduledTime;
  }
  if (typeof source.goBackNotes === "string" && source.goBackNotes) goBack.notes = source.goBackNotes;
  return goBack;
}

function nestedObjection(source: Record<string, unknown>): FieldDispoBody["objection"] | undefined {
  if (typeof source.objectionType !== "string" || !source.objectionType) return undefined;
  const objection: NonNullable<FieldDispoBody["objection"]> = { type: source.objectionType };
  if (typeof source.objectionNotes === "string" && source.objectionNotes) objection.notes = source.objectionNotes;
  return objection;
}

/** Photos and handoff are never included. draftId is the idempotency key. actionAt is ISO. */
export function fieldDispoBody(
  m: PendingMutation,
  user: User,
  patch?: Partial<Lead>,
): FieldDispoBody {
  if (m.kind === "handoff")
    throw invalid("Handoffs are not sent to the disposition route.");
  const sourcePatch = patch ?? reportingPatch(m, user);
  if (!DRAFT_ID_PATTERN.test(m.id))
    throw invalid("Draft id is not a valid idempotency key.");
  const actionAt = isoString(m.createdAt);
  if (!actionAt) throw invalid("Invalid knock time. Check the device clock.");
  const leadId = m.leadId;
  if (!leadId || leadId.includes("/") || leadId.length > 1500) throw invalid("Lead id is not valid for the disposition route.");
  if (m.kind === "notes") {
    const notes = m.notes ?? (typeof sourcePatch.notes === "string" ? sourcePatch.notes : "");
    return {
      leadId,
      draftId: m.id,
      kind: "notes",
      actionAt,
      notes,
      baseNotes: typeof m.baseNotes === "string" ? m.baseNotes : null,
    };
  }
  const source = sourcePatch as Record<string, unknown>;
  const status = (typeof source.status === "string" && source.status) || m.status || "";
  if (!status || status === "claimed" || status === "unclaimed")
    throw invalid("Use the claim/unclaim action for ownership changes.");
  const own = reportingPatch(m, user).dispositionHistory?.[0];
  const disposition = own?.disposition || m.disposition || status;
  const userName = own?.userName || m.userName || user.name;
  const body: FieldDispoBody = {
    leadId,
    draftId: m.id,
    kind: "knock",
    actionAt,
    status,
    disposition,
    userName,
  };
  const gps = nestedGps(source);
  if (gps) body.gps = gps;
  const goBack = nestedGoBack(source);
  if (goBack) body.goBack = goBack;
  const objection = nestedObjection(source);
  if (objection) body.objection = objection;
  if (m.direct?.gpsPointSource === "homeowner_corrected" && m.direct.homeownerId && !m.direct.homeownerId.includes("/"))
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
  result?: unknown;
  gps?: { outcome?: unknown };
} | null> {
  try {
    return (await response.json()) as {
      currentNotes?: unknown;
      reasonCode?: unknown;
      lead?: Lead;
      result?: unknown;
      gps?: { outcome?: unknown };
    };
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
  let draft = m;
  let body = fieldDispoBody(draft, user);
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
    if (response.status === 409 && !notesRetried && draft.kind === "notes") {
      const data = await readJson(response);
      const currentNotes = typeof data?.currentNotes === "string" ? data.currentNotes : "";
      const rebased = rebaseNotes(draft.baseNotes ?? "", body.notes ?? draft.notes ?? "", currentNotes);
      notesRetried = true;
      draft = { ...draft, notes: rebased.notes, baseNotes: rebased.baseNotes };
      body = fieldDispoBody(draft, user);
      response = await send(token);
      continue;
    }
    break;
  }
  if (response.status === 200 || response.status === 201) {
    const data = await readJson(response);
    if (data?.gps?.outcome === "flagged_accepted") {
      try {
        await recordSyncEvent({
          id: crypto.randomUUID(),
          userId: m.userId,
          at: Date.now(),
          draftId: m.id,
          leadId: m.leadId,
          createdAt: m.createdAt,
          status: m.status,
          disposition: m.disposition,
          state: "flagged",
          parkedReason: SYNC_REASON.gpsUnverifiedFlagged,
          attempts: m.attempts ?? 0,
        });
        await reportParked(m.userId);
      } catch { /* a sync-report failure never stops a saved dispo */ }
    }
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

/**
 * Any non-2xx from the route retries the plain 14.17 patch first.
 * A draft parks or stays queued only when that patch is denied too, and then
 * the route's own status is what the outbox sees. A 404 is never replaced.
 */
async function plainPatchAfterRoute(
  m: PendingMutation,
  user: User,
  routeFailure: unknown,
  commit: NonNullable<FieldDispoDeps["commit"]>,
): Promise<{ replayed: boolean; lead?: Lead }> {
  try {
    return await commit(withoutGpsFlagKeys(m), user);
  } catch {
    throw routeFailure;
  }
}

/** Firestore first for pins the client can write. Notes keep the baseNotes check there. Handoffs never use this route. */
export async function deliverFieldDispo(
  m: PendingMutation,
  user: User,
  deps: FieldDispoDeps = {},
): Promise<{ replayed: boolean; lead?: Lead }> {
  const commit = deps.commit ?? commitDirectMutation;
  if (m.kind === "handoff") return commit(m, user);
  if (m.direct?.serverDispo) {
    try {
      return await postFieldDispo(m, user, deps);
    } catch (routeFailure) {
      return plainPatchAfterRoute(m, user, routeFailure, commit);
    }
  }
  try {
    return await commit(m, user);
  } catch (error) {
    if (!permissionDenied(error as Error & { code?: string })) throw error;
    try {
      return await postFieldDispo(m, user, deps);
    } catch (routeFailure) {
      return plainPatchAfterRoute(m, user, routeFailure, commit);
    }
  }
}
