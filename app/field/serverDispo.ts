import type { Lead, User } from "@/app/types";
import { apiFetch } from "@/app/utils/apiFetch";
import { auth } from "@/app/utils/firebase";
import { isScheduledGoBackStatus } from "@/app/types/disposition";
import { coerceLegacyContactDraft, hasContactFields, notesWereEdited } from "./contactSave";
import { commitDirectMutation, historyGpsFlag, reportingPatch } from "./directWrites";
import { decideKnockGps, gpsFlagOf, type GpsFlag } from "@/app/utils/gpsRule";
import { rebaseNotes } from "./notesRebase";
import { deliberateNotesClear, NON_OWNER_DIRECT_NOTES_MAX_CHARS, NOTES_ROUTE_BODY_MAX_BYTES, notesRouteBody, notesTextOf, utf8Bytes } from "./notesLimits";
import { recordSyncEvent, reportParked } from "./syncDiagnostics";
import { FIELD_DISPO_UNAVAILABLE, SYNC_REASON, type SyncReasonCode } from "./syncReasons";
import type { PendingMutation } from "./types";

export { rebaseNotes } from "./notesRebase";

export const DRAFT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const FIELD_DISPO_PATH = "/api/field/dispo";
/** Slow retry while the route is not deployed. App start tries again immediately. */
export const SERVER_DISPO_SLOW_RETRY_MS = 15 * 60 * 1000;

const GPS_FLAG_FIELDS = ["gpsVerified", "gpsUnverifiedReason", "gpsDistanceM"] as const;

type DispoLead = Pick<Lead, "historicalTerritoryPin" | "claimedBy" | "assignedTo" | "setterId" | "source"> & {
  territoryId?: string;
};

/** One ownership check for routing and the area gate. setterId counts only on a manual pin. */
export function leadOwnedBy(
  lead: Pick<DispoLead, "claimedBy" | "assignedTo" | "setterId" | "source">,
  uid: string,
): boolean {
  return !!uid && (
    lead.claimedBy === uid
    || lead.assignedTo === uid
    || (lead.setterId === uid && lead.source === "manually-added")
  );
}

/**
 * Historical pins cannot be written from the client. Everything an admin could
 * write in 14.17 stays a direct write, including an unowned pin with no territory.
 * A rep still uses the route for an unowned pin with no territory, because the
 * client cannot read that lead in order to commit a transaction.
 */
export function prefersServerDispo(lead: DispoLead, uid: string, role?: string): boolean {
  if (lead.historicalTerritoryPin) return true;
  if (role === "admin") return false;
  if (leadOwnedBy(lead, uid)) return false;
  return !lead.territoryId;
}

/**
 * Notes from 10,001 through 100,000 characters on a lead this rep does not own
 * go to the route. #170 accepts them. An owner or admin still writes directly.
 */
export function notesDraftUsesRoute(
  lead: DispoLead,
  uid: string,
  role: string | undefined,
  notes: string,
): boolean {
  if (prefersServerDispo(lead, uid, role)) return true;
  if (role === "admin" || leadOwnedBy(lead, uid)) return false;
  return notes.length > NON_OWNER_DIRECT_NOTES_MAX_CHARS;
}

export function notesRouteBodyTooLarge(body: FieldDispoBody): boolean {
  return body.kind === "notes" && utf8Bytes(JSON.stringify(body)) > NOTES_ROUTE_BODY_MAX_BYTES;
}

/** Split a queued knock-plus-note into two drafts. Unsafe drafts are parked, never dropped. */
export function splitCombinedDraft(
  m: PendingMutation,
  existingIds: ReadonlySet<string>,
): { knock: PendingMutation; notes: PendingMutation } | "unsafe" | null {
  const patch = m.direct?.patch;
  if (!patch) return null;
  const history = patch.dispositionHistory;
  const notes = typeof patch.notes === "string" ? patch.notes : undefined;
  if (notes == null || !history?.length) return null;
  const knockId = `${m.id}-knock`;
  const notesId = `${m.id}-notes`;
  const status = (typeof patch.status === "string" && patch.status) || m.status || "";
  const disposition = history[0]?.disposition || m.disposition || status;
  if (
    !m.leadId
    || !m.userId
    || !DRAFT_ID_PATTERN.test(knockId)
    || !DRAFT_ID_PATTERN.test(notesId)
    || existingIds.has(knockId)
    || existingIds.has(notesId)
    || !status
    || status === "claimed"
    || status === "unclaimed"
    || !disposition
  ) return "unsafe";
  const knockPatch = { ...patch };
  delete knockPatch.notes;
  const knock: PendingMutation = {
    ...m,
    id: knockId,
    kind: "knock",
    status,
    disposition,
    direct: { ...m.direct, patch: knockPatch },
  };
  delete knock.notes;
  return {
    knock,
    notes: {
      ...m,
      id: notesId,
      kind: "notes",
      notes,
      status: undefined,
      disposition: undefined,
      direct: { ...m.direct, patch: { notes } },
    },
  };
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
  /** Present only on a deliberate clear, with notes:"". Route reference: main 15efe05. */
  clearNotes?: boolean;
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
    const notes = typeof m.notes === "string"
      ? m.notes
      : typeof sourcePatch.notes === "string" ? sourcePatch.notes : undefined;
    if (typeof notes !== "string") throw invalid("This save does not include a note.");
    const baseNotes = typeof m.baseNotes === "string" ? m.baseNotes : null;
    if (!notes.trim()) {
      if (!deliberateNotesClear(m)) throw routeError("Notes were rejected.", 400, SYNC_REASON.notesRejected);
      return notesRouteBody({
        leadId,
        draftId: m.id,
        actionAt,
        notes: "",
        baseNotes,
        clearNotes: true,
      });
    }
    return notesRouteBody({
      leadId,
      draftId: m.id,
      actionAt,
      notes,
      baseNotes,
    });
  }
  if (m.kind !== "knock") throw invalid("Contact edits are not sent to the disposition route.");
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
  const goBackChoice = isScheduledGoBackStatus(status)
    || /^(go back|house for sale)$/i.test(disposition.trim());
  if (goBackChoice) {
    const goBack = nestedGoBack(source);
    if (goBack) body.goBack = goBack;
  } else {
    const objection = nestedObjection(source);
    if (objection) body.objection = objection;
  }
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

/** Keys territoryDisposition allows at firestore.rules 79d1daa (PR #171). */
export const DISPOSITION_RULES_KEYS = [
  "status",
  "disposition",
  "dispositionedAt",
  "dispositionHistory",
  "knockGpsLat",
  "knockGpsLng",
  "knockGpsAccuracy",
  "knockGpsTimestamp",
  "knockDistanceFromAddress",
  "gpsVerified",
  "gpsUnverifiedReason",
  "gpsDistanceM",
  "objectionType",
  "objectionNotes",
  "objectionRecordedAt",
  "objectionRecordedBy",
  "goBackScheduledDate",
  "goBackScheduledTime",
  "goBackNotes",
  "goBackScheduledBy",
  "notes",
] as const;

/** Fields the 14.17 direct patch carried. Contact and photo keys stay even though #171 denies them. */
export const LEGACY_14_17_PATCH_KEYS = [
  "status",
  "disposition",
  "dispositionedAt",
  "dispositionHistory",
  "knockGpsLat",
  "knockGpsLng",
  "knockGpsAccuracy",
  "knockGpsTimestamp",
  "knockDistanceFromAddress",
  "objectionType",
  "objectionNotes",
  "objectionRecordedAt",
  "objectionRecordedBy",
  "goBackScheduledDate",
  "goBackScheduledTime",
  "goBackNotes",
  "goBackScheduledBy",
  "notes",
  "photos",
  "name",
  "address",
  "city",
  "state",
  "zip",
  "phone",
  "email",
  "estimatedBill",
] as const;

const RULES_OR_LEGACY = new Set<string>([...DISPOSITION_RULES_KEYS, ...LEGACY_14_17_PATCH_KEYS]);

/** Copy the true top-level verdict onto the new history entry, then the fallback strips those keys. */
function withHistoryGpsFlag(m: PendingMutation): PendingMutation {
  const patch = m.direct?.patch;
  const history = patch?.dispositionHistory;
  if (!patch || !history?.length) return m;
  const flag = historyGpsFlag(patch);
  if (!flag) return m;
  const [newest, ...older] = history;
  const same = newest.gpsFlag?.gpsVerified === flag.gpsVerified
    && newest.gpsFlag?.gpsUnverifiedReason === flag.gpsUnverifiedReason
    && newest.gpsFlag?.gpsDistanceM === flag.gpsDistanceM;
  if (same) return m;
  return {
    ...m,
    direct: {
      ...m.direct,
      patch: { ...patch, dispositionHistory: [{ ...newest, gpsFlag: flag }, ...older] },
    },
  };
}

/**
 * The route writes this flag itself from `gps`. It is not a body field:
 * #170 rejects unknown keys. The shape is gpsFlagOf(decideKnockGps(...)).
 */
export function routeHistoryGpsFlag(
  body: FieldDispoBody,
  reference: { lat: number; lng: number } | null,
  role?: string,
): GpsFlag {
  const actionAtMs = Date.parse(body.actionAt);
  const capturedAtMs = body.gps ? Date.parse(body.gps.capturedAt) : Number.NaN;
  const fix = body.kind !== "knock" || !body.gps
    ? "absent" as const
    : Number.isFinite(capturedAtMs)
      ? { lat: body.gps.lat, lng: body.gps.lng, accuracyM: body.gps.accuracyM, capturedAtMs }
      : "malformed" as const;
  return gpsFlagOf(decideKnockGps({ fix, actionAtMs, reference, role }));
}

/** Drop a key only when #171 denies it and 14.17 did not write it. Dates stay Dates. */
export function plainFallbackMutation(m: PendingMutation): PendingMutation {
  const stripped = withoutGpsFlagKeys(withHistoryGpsFlag(m));
  if (!stripped.direct?.patch) return stripped;
  const patch = { ...stripped.direct.patch } as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    if (!RULES_OR_LEGACY.has(key)) delete patch[key];
  }
  return { ...stripped, direct: { ...stripped.direct, patch: patch as Partial<Lead> } };
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
  field?: unknown;
  lead?: Lead;
  result?: unknown;
  gps?: { outcome?: unknown };
} | null> {
  try {
    return (await response.json()) as {
      currentNotes?: unknown;
      reasonCode?: unknown;
      field?: unknown;
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
  const notesText = m.kind === "notes" ? notesTextOf(m) : undefined;
  if (typeof notesText === "string" && !notesText.trim() && !deliberateNotesClear(m))
    throw routeError("Notes were rejected.", 400, SYNC_REASON.notesRejected);
  let draft = m;
  let rebasedDraft: PendingMutation | undefined;
  let body = fieldDispoBody(draft, user);
  if (notesRouteBodyTooLarge(body))
    throw routeError("Notes too long", 413, SYNC_REASON.notesTooLong);
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
    if (response.status === 409 && !notesRetried && draft.kind === "notes" && body.clearNotes !== true) {
      const data = await readJson(response);
      const currentNotes = typeof data?.currentNotes === "string" ? data.currentNotes : "";
      const rebased = rebaseNotes(draft.baseNotes ?? "", body.notes ?? draft.notes ?? "", currentNotes);
      notesRetried = true;
      draft = {
        ...draft,
        notes: rebased.notes,
        baseNotes: rebased.baseNotes,
        ...(draft.direct ? { direct: { ...draft.direct, patch: { ...draft.direct.patch, notes: rebased.notes } } } : {}),
      };
      rebasedDraft = draft;
      body = fieldDispoBody(draft, user);
      if (notesRouteBodyTooLarge(body)) {
        throw Object.assign(routeError("Notes too long", 413, SYNC_REASON.notesTooLong), { rebasedDraft: draft });
      }
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
  const fail = (error: Error): never => {
    if (rebasedDraft) (error as Error & { rebasedDraft?: PendingMutation }).rebasedDraft = rebasedDraft;
    throw error;
  };
  if (response.status === 404) fail(unavailable());
  if (response.status === 401)
    fail(Object.assign(Error("Sign in again to sync your work."), { status: 401 }));
  if (response.status === 410)
    fail(routeError("This lead is gone.", 410, SYNC_REASON.notFound));
  if (response.status === 413) {
    const data = await readJson(response);
    const reason = typeof data?.reasonCode === "string" ? data.reasonCode : "";
    if (reason === SYNC_REASON.payloadTooLarge)
      fail(routeError("Disposition route rejected this knock.", 413, SYNC_REASON.payloadTooLarge));
    fail(routeError(
      draft.kind === "notes" ? "Notes too long" : "Disposition route rejected this knock.",
      413,
      draft.kind === "notes" ? SYNC_REASON.notesTooLong : SYNC_REASON.payloadTooLarge,
    ));
  }
  if (response.status === 400) {
    const data = await readJson(response);
    const field = typeof data?.field === "string" ? data.field : "";
    const reason = typeof data?.reasonCode === "string" ? data.reasonCode : "";
    if (
      reason === SYNC_REASON.notesEmpty
      || reason === SYNC_REASON.notesClearMismatch
      || field === "clearNotes"
    ) fail(routeError("Notes were rejected.", 400, SYNC_REASON.notesRejected));
    if (draft.kind === "notes" && (field === "notes" || field === "baseNotes"))
      fail(routeError("Notes too long", 400, SYNC_REASON.notesTooLong));
    fail(routeError("Disposition route rejected this knock.", 400, SYNC_REASON.invalidPayload));
  }
  if (response.status === 403) {
    const data = await readJson(response);
    fail(routeError(
      "The disposition route denied this knock.",
      403,
      knownReason(data?.reasonCode) || SYNC_REASON.other,
    ));
  }
  if (response.status === 409) {
    if (deliberateNotesClear(draft))
      fail(routeError("Notes were rejected.", 409, SYNC_REASON.notesRejected));
    fail(routeError("Notes changed on another device. Review this draft.", 409, SYNC_REASON.notesConflict));
  }
  if (response.status === 429)
    fail(Object.assign(Error("Disposition route asked us to wait."), {
      status: 429,
      retryAfterMs: retryAfterDelayMs(response.headers.get("retry-after")),
    }));
  if (response.status >= 500 || response.status === 408)
    fail(Object.assign(Error("Disposition route unavailable."), { status: response.status }));
  return fail(routeError("Disposition route rejected this knock.", response.status || 400, SYNC_REASON.invalidPayload));
}

function permissionDenied(error: Error & { status?: number; code?: string }): boolean {
  return error.code === "permission-denied";
}

function terminalNotesFailure(error: unknown, draft?: PendingMutation): boolean {
  const code = (error as { reasonCode?: string }).reasonCode;
  if (code === SYNC_REASON.notesTooLong || code === SYNC_REASON.notesRejected) return true;
  return code === SYNC_REASON.notesConflict && !!draft && deliberateNotesClear(draft);
}

/** Offline and transport failures must stay queued. They do not adopt the route status. */
function temporaryPlainFailure(error: Error & { status?: number; code?: string }): boolean {
  const status = error.status || 0;
  const code = String(error.code || "").toLowerCase();
  const message = error.message || "";
  if (status === 401 || status === 408 || status === 429 || status >= 500) return true;
  if (
    code === "unavailable"
    || code === "deadline-exceeded"
    || code === "aborted"
    || code === "failed-precondition"
    || code === "network-request-failed"
    || code === "offline"
  ) return true;
  return /offline|network|failed to fetch/i.test(message);
}

function historicalPlainFailure(error: Error): boolean {
  return /historical/i.test(error.message || "");
}

/**
 * Any non-2xx from the route retries the plain 14.17 patch first.
 * A temporary plain failure is rethrown so the draft stays queued.
 * Only a permission denial or a historical pin adopts the route status.
 */
async function plainPatchAfterRoute(
  m: PendingMutation,
  user: User,
  routeFailure: unknown,
  commit: NonNullable<FieldDispoDeps["commit"]>,
): Promise<{ replayed: boolean; lead?: Lead }> {
  try {
    const carried = routeFailure as { rebasedDraft?: PendingMutation };
    return await commit(plainFallbackMutation(carried?.rebasedDraft ?? m), user);
  } catch (error) {
    const failure = error as Error & { status?: number; code?: string };
    if (!temporaryPlainFailure(failure) && (permissionDenied(failure) || historicalPlainFailure(failure)))
      throw routeFailure;
    throw failure;
  }
}

function detachServerDispo(m: PendingMutation): PendingMutation {
  if (!m.direct?.serverDispo) return m;
  const direct = { ...m.direct };
  delete direct.serverDispo;
  return { ...m, direct };
}

/** Contact and photo writes stay on Firestore. A denial is never turned into a notes body. */
async function commitContactWrite(
  m: PendingMutation,
  user: User,
  commit: NonNullable<FieldDispoDeps["commit"]>,
): Promise<{ replayed: boolean; lead?: Lead }> {
  try {
    return await commit(detachServerDispo(m), user);
  } catch (error) {
    const failure = error as Error & { status?: number; code?: string };
    if (!permissionDenied(failure)) throw failure;
    throw Object.assign(failure, { status: 403, code: "permission-denied", reasonCode: SYNC_REASON.contactDenied });
  }
}

function writesContactDirect(m: PendingMutation): boolean {
  if (m.kind === "contact") return true;
  if (m.kind !== "notes") return false;
  if (!notesWereEdited(m)) return hasContactFields(m) || typeof m.notes !== "string";
  return hasContactFields(m);
}

/** Firestore first for pins the client can write. Notes keep the baseNotes check there. Handoffs never use this route. */
export async function deliverFieldDispo(
  m: PendingMutation,
  user: User,
  deps: FieldDispoDeps = {},
): Promise<{ replayed: boolean; lead?: Lead }> {
  const commit = deps.commit ?? commitDirectMutation;
  const prepared = coerceLegacyContactDraft(m);
  const preparedNotes = prepared.kind === "notes" ? notesTextOf(prepared) : undefined;
  if (typeof preparedNotes === "string" && !preparedNotes.trim() && !deliberateNotesClear(prepared))
    throw routeError("Notes were rejected.", 400, SYNC_REASON.notesRejected);
  if (prepared.kind === "handoff") return commit(prepared, user);
  if (writesContactDirect(prepared)) return commitContactWrite(prepared, user, commit);
  if (prepared.direct?.serverDispo) {
    try {
      return await postFieldDispo(prepared, user, deps);
    } catch (routeFailure) {
      if (terminalNotesFailure(routeFailure, prepared)) throw routeFailure;
      return plainPatchAfterRoute(prepared, user, routeFailure, commit);
    }
  }
  try {
    return await commit(prepared, user);
  } catch (error) {
    if (!permissionDenied(error as Error & { code?: string })) throw error;
    try {
      return await postFieldDispo(prepared, user, deps);
    } catch (routeFailure) {
      if (terminalNotesFailure(routeFailure, prepared)) throw routeFailure;
      return plainPatchAfterRoute(prepared, user, routeFailure, commit);
    }
  }
}
