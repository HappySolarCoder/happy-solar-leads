import type { Lead, User } from "@/app/types";
import { apiFetch } from "@/app/utils/apiFetch";
import { auth } from "@/app/utils/firebase";
import { isScheduledGoBackStatus } from "@/app/types/disposition";
import { coerceLegacyContactDraft, hasContactFields, notesWereEdited } from "./contactSave";
import { ACTION_AT_STALE_MS, freshDraftId } from "./draftQueue";
import { commitDirectMutation, historyGpsFlag, reportingPatch, type DirectCommitIo } from "./directWrites";
import { decideKnockGps, gpsFlagOf, type GpsFlag } from "@/app/utils/gpsRule";
import { clearAfterConflict, NOTES_CLEAR_KEPT_NOTICE, notesAfterConflict, notesAgainstBase, sameNotes } from "./notesRebase";
import { deliberateNotesClear, NOTES_CLEAR_UNAVAILABLE_MESSAGE, NOTES_MAX_CHARS, NOTES_OTHER_REP_MESSAGE, NOTES_ROUTE_BODY_MAX_BYTES, NOTES_TOO_LONG_MESSAGE, notesRouteBody, notesTextOf, utf8Bytes } from "./notesLimits";
import { recordSyncEvent, reportInBackground, reportParked } from "./syncDiagnostics";
import { ACTION_AT_FUTURE_MS, ACTION_AT_SERVER_LAG_MS, FIELD_DISPO_UNAVAILABLE, NOTES_ACTION_AT_RETRY_MESSAGE, PHONE_CLOCK_NOTICE, SYNC_REASON, type SyncReasonCode } from "./syncReasons";
import type { PendingMutation } from "./types";
import { HOT_CLAIM_PATH, HOT_LEAD_MISSING_NOTICE, HOT_LEAD_OLD_SERVER_NOTICE, HOT_LEAD_OWNED_MESSAGE, hotClaimBody, isHotLeadDraft } from "@/app/hotLeads/save";

export { rebaseNotes } from "./notesRebase";

export const DRAFT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const FIELD_DISPO_PATH = "/api/field/dispo";
/** Slow retry while the route is not deployed. App start tries again immediately. */
/** NOTES-MERGE-SPEC V4 answers: notes sends per draft per flush (the first send plus two 409 re-merges). */
export const NOTES_MAX_SENDS = 3;
/** Typed (non-clear) notes: the first send plus one re-merge per flush, as in 14.18. */
export const NOTES_TYPED_MAX_SENDS = 2;
/** NOTES-MERGE-SPEC V4 answers: a notes draft (clear or typed) still answered 409 after NOTES_MAX_SENDS stays pending with this text. */
export const NOTES_CLEAR_PENDING_MESSAGE = "Pending. Notes changed on another device.";

/** NOTES-MERGE-SPEC v4 answers, GATED blankSentUnflagged = 0: notes that are blank under JS trim go out only with clearNotes === true. */
export function blankNotesUnflagged(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as { notes?: unknown; clearNotes?: unknown };
  return typeof b.notes === "string" && b.notes.trim() === "" && b.clearNotes !== true;
}

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
 * Every notes draft goes to /api/field/dispo. Main 15efe05 accepts the owner
 * and an admin: ownership skips the territory gate, and applyNotes only checks
 * baseNotes. The receipt dedupes a replay. Contact and photo writes stay direct.
 */
export function notesDraftUsesRoute(
  _lead: DispoLead,
  _uid: string,
  _role: string | undefined,
  _notes: string,
): boolean {
  return true;
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
  const notesId = DRAFT_ID_PATTERN.test(m.id) ? m.id : freshDraftId(m.id, "notes", existingIds);
  const knockId = freshDraftId(m.id, "knock", existingIds);
  const status = (typeof patch.status === "string" && patch.status) || m.status || "";
  const disposition = history[0]?.disposition || m.disposition || status;
  if (
    !m.leadId
    || !m.userId
    || !DRAFT_ID_PATTERN.test(knockId)
    || !DRAFT_ID_PATTERN.test(notesId)
    || knockId === notesId
    || existingIds.has(knockId)
    || (notesId !== m.id && existingIds.has(notesId))
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
    (m.routeHold === "field-dispo" || m.routeHold === "hot-leads") && m.syncState === "queued"
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
  /** Present only for a hot lead. Absent, the body is a leads write. */
  collection?: "hotLeads";
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

function asDispoBody(m: PendingMutation, body: FieldDispoBody): FieldDispoBody {
  if (m.collection !== "hotLeads") return body;
  return { ...body, collection: "hotLeads" };
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
      return asDispoBody(m, notesRouteBody({
        leadId,
        draftId: m.id,
        actionAt,
        notes: "",
        baseNotes,
        clearNotes: true,
      }));
    }
    return asDispoBody(m, notesRouteBody({
      leadId,
      draftId: m.id,
      actionAt,
      notes,
      baseNotes,
    }));
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
  return asDispoBody(m, body);
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
  /** Defense in depth for a direct notes write. The route dedupes by draftId and does not use this. */
  persistDraft?: (draft: PendingMutation) => Promise<unknown>;
  /** Clock check for a 400 actionAt. Defaults to Date.now. */
  now?: () => number;
};

async function readJson(response: Response): Promise<{
  currentNotes?: unknown;
  reasonCode?: unknown;
  error?: unknown;
  field?: unknown;
  duplicate?: unknown;
  lead?: Lead;
  result?: unknown;
  gps?: { outcome?: unknown };
} | null> {
  try {
    return (await response.json()) as {
      currentNotes?: unknown;
      reasonCode?: unknown;
      error?: unknown;
      field?: unknown;
      duplicate?: unknown;
      lead?: Lead;
      result?: unknown;
      gps?: { outcome?: unknown };
    };
  } catch {
    return null;
  }
}

/** #180 uses this body for a missing hot lead. Any other 404 is the route not being live. */
function hotLeadMissingBody(data: { error?: unknown; reasonCode?: unknown } | null): boolean {
  return data?.error === "not_found" || data?.reasonCode === "not_found";
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
): Promise<{ replayed: boolean; lead?: Lead; appliedNotes?: string; notice?: string }> {
  const post = deps.post ?? apiFetch;
  const getToken = deps.getToken ?? (async (forceRefresh = false) => {
    const current = auth?.currentUser;
    if (!current) return "";
    return current.getIdToken(forceRefresh);
  });
  const notesText = m.kind === "notes" ? notesTextOf(m) : undefined;
  if (typeof notesText === "string" && !notesText.trim() && !deliberateNotesClear(m))
    throw routeError("Notes were rejected.", 400, SYNC_REASON.notesRejected);
  const localNow = () => deps.now?.() ?? Date.now();
  let draft = trimmedNotesDraft(m);
  const stamped = stampNotesActionAt(draft, localNow());
  draft = stamped.draft;
  let rebasedDraft: PendingMutation | undefined;
  let body = fieldDispoBody(draft, user);
  if (notesCharsTooLong(draft) || notesRouteBodyTooLarge(body))
    throw routeError(NOTES_TOO_LONG_MESSAGE, 413, SYNC_REASON.notesTooLong);
  let token = await getToken(false);
  if (!token) throw Error("Sign in again to sync your work.");
  let refreshed = false;
  // NOTES-MERGE-SPEC V4 answers: at most 3 notes sends per draft per flush; each 409 re-merges against the fresh current.
  let notesSends = 1;
  // The draft as queued. Every 409 re-merges this intent (v5 ruling 3); a pending draft is stored as this intent.
  let intent: PendingMutation | undefined;
  let actionAtRetried = false;
  let clearNotice: string | undefined;
  const send = (bearer: string) => {
    // Last check before the wire: 49f4762 would really clear on blank notes without the flag.
    if (blankNotesUnflagged(body)) throw routeError("Notes were rejected.", 400, SYNC_REASON.notesRejected);
    return post(FIELD_DISPO_PATH, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  };
  // The rep's original intent: the queued draft, or the intent a pending draft carries (v5 ruling 3).
  if (draft.kind === "notes" && m.notesIntent) {
    const { notes, baseNotes, clearNotes } = m.notesIntent;
    intent = {
      ...draft,
      notes,
      baseNotes,
      ...(draft.direct ? { direct: { ...draft.direct, patch: { ...draft.direct.patch, notes } } } : {}),
    };
    if (clearNotes) intent.clearNotes = true;
    else delete intent.clearNotes;
  }
  // Re-merge the original intent against a fresh current. landed: the server already holds the result, nothing to write.
  const remergeIntent = (currentNotes: string): { landed: true } | { landed: false; merged: string } => {
    intent ??= draft;
    if (deliberateNotesClear(intent)) {
      // V4: a clear is ours = ''. diff3(base, current, '') deletes the base lines, keeps the lines the server added.
      const merged = clearAfterConflict(withDeviceKnown(intent), currentNotes);
      // C6-1: the merge is trimmed before deciding; a blank merge onto a blank current already landed. Nothing is sent.
      if (!merged.trim() && !currentNotes.trim()) return { landed: true };
      clearNotice = merged ? NOTES_CLEAR_KEPT_NOTICE : undefined;
      return { landed: false, merged };
    }
    // The server already holds this text (edge blank lines aside): it landed. No second write.
    if (typeof intent.notes === "string" && sameNotes(currentNotes, intent.notes)) {
      rememberLandedNotes(intent, currentNotes, localNow());
      return { landed: true };
    }
    const merged = notesAfterConflict(withDeviceKnown(intent), currentNotes).notes;
    // Rules 2 and 3 (or rule 5 falling back to current): the merge is the server text. Nothing to write.
    // C6-1: this also covers a whitespace-only merge onto a blank current (both trim to '').
    if (sameNotes(merged, currentNotes)) return { landed: true };
    return { landed: false, merged };
  };
  // The draft that carries a merge: v5 ruling 1, a merge whose result is '' goes out as a flagged clear
  // (clearNotes:true, notes:'', baseNotes=current).
  const mergedDraft = (merged: string, currentNotes: string): PendingMutation => {
    const text = merged.trim() ? merged : "";
    const next: PendingMutation = {
      ...draft,
      notes: text,
      baseNotes: currentNotes,
      ...(draft.direct ? { direct: { ...draft.direct, patch: { ...draft.direct.patch, notes: text } } } : {}),
    };
    if (!text) next.clearNotes = true;
    else delete next.clearNotes;
    return next;
  };
  let response = await send(token);
  for (;;) {
    rememberServerNow(localNow(), response.headers.get("date"));
    if (response.status === 401 && !refreshed) {
      refreshed = true;
      token = await getToken(true);
      if (!token) throw Object.assign(Error("Sign in again to sync your work."), { status: 401 });
      response = await send(token);
      continue;
    }
    // A clear gets up to NOTES_MAX_SENDS per flush (V4 answers); typed notes keep 14.18's single re-merge (2 sends, within the cap).
    if (response.status === 409 && draft.kind === "notes"
      && notesSends < (deliberateNotesClear(intent ?? draft) ? NOTES_MAX_SENDS : NOTES_TYPED_MAX_SENDS)) {
      // NOTES-MERGE-SPEC v5 rulings 3 and 6: every 409 re-merges the ORIGINAL intent against the fresh current,
      // diff3(original base, fresh current, the rep's text), never the previous merge. The first send is send 1 of 3.
      const data = await readJson(response);
      const currentNotes = typeof data?.currentNotes === "string" ? data.currentNotes : "";
      const next = remergeIntent(currentNotes);
      if (next.landed) return { replayed: true, appliedNotes: currentNotes };
      const merged = next.merged;
      notesSends += 1;
      draft = mergedDraft(merged, currentNotes);
      body = fieldDispoBody(draft, user);
      if (notesCharsTooLong(draft) || notesRouteBodyTooLarge(body)) {
        // Over the limit: the merged text is what is too long. A clear intent stays the clear.
        const overChars = notesCharsTooLong(draft);
        throw Object.assign(
          routeError(NOTES_TOO_LONG_MESSAGE, 413, SYNC_REASON.notesTooLong),
          overChars || deliberateNotesClear(intent ?? draft) ? {} : { rebasedDraft: draft },
        );
      }
      response = await send(token);
      continue;
    }
    if (response.status === 400 && !actionAtRetried && draft.kind === "notes") {
      const data = await readJson(response.clone());
      const field = typeof data?.field === "string" ? data.field : "";
      if (field === "actionAt") {
        actionAtRetried = true;
        const serverNow = rememberServerNow(localNow(), response.headers.get("date"));
        draft = restampNotes(draft, serverNow - ACTION_AT_SERVER_LAG_MS);
        body = fieldDispoBody(draft, user);
        response = await send(token);
        continue;
      }
    }
    break;
  }
  if (response.status === 200 || response.status === 201) {
    const data = await readJson(response);
    const appliedNotes = draft.kind === "notes" && typeof draft.notes === "string" ? draft.notes : undefined;
    const notice = clearNotice ? { notice: clearNotice } : {};
    if (typeof appliedNotes === "string") rememberLandedNotes(draft, appliedNotes, localNow());
    if (data?.duplicate === true) return { replayed: true, appliedNotes, ...notice };
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
      } catch { /* a sync-report failure never stops a saved dispo */ }
      reportInBackground(() => reportParked(m.userId));
    }
    return { replayed: false, lead: data?.lead, appliedNotes, ...notice };
  }
  const fail = (error: Error): never => {
    if (rebasedDraft) (error as Error & { rebasedDraft?: PendingMutation }).rebasedDraft = rebasedDraft;
    throw error;
  };
  if (response.status === 404) {
    if (draft.collection === "hotLeads") {
      const data = await readJson(response);
      if (hotLeadMissingBody(data)) fail(routeError(HOT_LEAD_MISSING_NOTICE, 404, SYNC_REASON.notFound));
    }
    fail(unavailable());
  }
  if (response.status === 401)
    fail(Object.assign(Error("Sign in again to sync your work."), { status: 401 }));
  if (response.status === 410)
    fail(routeError("This lead is gone.", 410, SYNC_REASON.notFound));
  if (response.status === 413) {
    await readJson(response);
    if (draft.kind === "notes")
      fail(routeError("Notes too long", 413, SYNC_REASON.notesTooLong));
    fail(routeError("Disposition route rejected this knock.", 413, SYNC_REASON.payloadTooLarge));
  }
  if (response.status === 400) {
    const data = await readJson(response);
    const field = typeof data?.field === "string" ? data.field : "";
    const reason = typeof data?.reasonCode === "string" ? data.reasonCode : "";
    if (draft.collection === "hotLeads") {
      const notesField = field === "actionAt" || field === "notes" || field === "baseNotes" || field === "clearNotes"
        || reason === SYNC_REASON.notesEmpty || reason === SYNC_REASON.notesClearMismatch;
      if (!notesField) fail(routeError(HOT_LEAD_OLD_SERVER_NOTICE, 400, SYNC_REASON.invalidPayload));
    }
    if (draft.kind === "notes" && field === "actionAt") {
      const message = stamped.stale ? NOTES_ACTION_AT_RETRY_MESSAGE : PHONE_CLOCK_NOTICE;
      fail(routeError(message, 400, SYNC_REASON.notesRejected));
    }
    if (draft.kind === "notes" && field === "clearNotes")
      fail(routeError(NOTES_CLEAR_UNAVAILABLE_MESSAGE, 400, SYNC_REASON.notesRejected));
    if (
      draft.kind === "notes"
      && (reason === SYNC_REASON.notesEmpty || reason === SYNC_REASON.notesClearMismatch)
    ) fail(routeError("Notes were rejected.", 400, SYNC_REASON.notesRejected));
    if (draft.kind === "notes" && (field === "notes" || field === "baseNotes"))
      fail(routeError("Notes too long", 400, SYNC_REASON.notesTooLong));
    if (field === "actionAt")
      fail(Object.assign(routeError("Disposition route rejected this knock.", 400, SYNC_REASON.invalidPayload), { field: "actionAt" }));
    fail(routeError("Disposition route rejected this knock.", 400, SYNC_REASON.invalidPayload));
  }
  if (response.status === 403) {
    const data = await readJson(response);
    const reason = knownReason(data?.reasonCode) || SYNC_REASON.other;
    if (draft.kind === "notes") {
      fail(routeError(
        reason === SYNC_REASON.ownedByOther ? NOTES_OTHER_REP_MESSAGE : "Notes weren't saved.",
        403,
        reason,
      ));
    }
    fail(routeError("The disposition route denied this knock.", 403, reason));
  }
  if (response.status === 409) {
    // NOTES-MERGE-SPEC V4 answers: still 409 after 3 sends. The draft stays pending and the next flush retries it.
    if (intent && !deliberateNotesClear(intent)) {
      // Typed notes stay pending as the draft the rep queued (14.18): the next flush sends it and re-merges this intent.
      rebasedDraft = undefined;
      fail(Object.assign(routeError(NOTES_CLEAR_PENDING_MESSAGE, 409, SYNC_REASON.notesConflict), { notesPending: true }));
    }
    if (intent) {
      // A clear stays pending as the clear merged against this last current (the body the next flush sends first,
      // V4), carrying the clear intent so every later 409 re-merges it (v5 ruling 3), never this merge.
      const data = await readJson(response);
      const currentNotes = typeof data?.currentNotes === "string" ? data.currentNotes : "";
      const next = remergeIntent(currentNotes);
      if (next.landed) return { replayed: true, appliedNotes: currentNotes };
      const own = intent;
      rebasedDraft = {
        ...mergedDraft(next.merged, currentNotes),
        notesIntent: {
          notes: typeof own.notes === "string" ? own.notes : "",
          baseNotes: own.baseNotes ?? "",
          ...(deliberateNotesClear(own) ? { clearNotes: true as const } : {}),
        },
      };
      fail(Object.assign(routeError(NOTES_CLEAR_PENDING_MESSAGE, 409, SYNC_REASON.notesConflict), { notesPending: true }));
    }
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

/** Server time from the last route Date header. Tests start from a cleared clock. */
let lastServerNowMs: number | undefined;

export function resetServerClockForTests(): void {
  lastServerNowMs = undefined;
}

function rememberServerNow(fallback: number, header?: string | null): number {
  if (header) {
    const parsed = Date.parse(header);
    if (Number.isFinite(parsed)) lastServerNowMs = parsed;
  }
  return lastServerNowMs ?? fallback;
}

/** knownSentNotes holds at most this many earlier texts (types.ts). */
const KNOWN_SENT_LIMIT = 10;

/**
 * Notes texts this device landed on each lead (this app session). A later draft for
 * the same lead is a new draft with its own knownSentNotes, so a 409 whose current is
 * one of these texts is still "a text this device already sent" (spec Decisions v4
 * answers, rule 1). Memory only; capped per lead and in lead count.
 */
const landedNotesByLead = new Map<string, LandedNotes[]>();
const LANDED_LEADS_LIMIT = 200;

type LandedNotes = { text: string; at: number };
type Ordered = { userId?: string; leadId?: string; createdAt?: string };

function landedKey(m: Ordered): string {
  return `${m.userId ?? ""}\u0000${m.leadId ?? ""}`;
}

/** `at` is when the route stored the text (device clock). */
export function rememberLandedNotes(m: Ordered, text: string, at: number = Date.now()): void {
  const key = landedKey(m);
  const list = (landedNotesByLead.get(key) || []).filter((t) => t.text !== text);
  list.push({ text, at });
  landedNotesByLead.delete(key);
  landedNotesByLead.set(key, list.slice(-KNOWN_SENT_LIMIT));
  while (landedNotesByLead.size > LANDED_LEADS_LIMIT) {
    const oldest = landedNotesByLead.keys().next().value;
    if (oldest === undefined) break;
    landedNotesByLead.delete(oldest);
  }
}

/** Test hook: forget every landed text. */
export function resetLandedNotes(): void {
  landedNotesByLead.clear();
}

/** The text landed before this draft was saved, so the rep saved it after seeing that text go out. */
function landedBefore(landed: LandedNotes, draft: Ordered): boolean {
  const saved = Date.parse(draft.createdAt || "");
  return Number.isFinite(saved) && landed.at < saved;
}

/**
 * The draft's own knownSentNotes plus the texts this device landed on the lead from
 * before this draft was saved. A text that landed later is never counted: an older
 * queued clear must not wipe a newer edit that went out first, and two queued siblings
 * do not override each other.
 */
function withDeviceKnown<T extends Ordered & { knownSentNotes?: string[] }>(draft: T): T {
  const landed = (landedNotesByLead.get(landedKey(draft)) || []).filter((t) => landedBefore(t, draft));
  if (!landed.length) return draft;
  const known = [...(draft.knownSentNotes || [])];
  for (const { text } of landed) if (!known.includes(text)) known.push(text);
  return { ...draft, knownSentNotes: known };
}

/**
 * A re-stamp of the same text keeps the draftId, so the route's receipt
 * fieldDispoReceipts/{uid}_{draftId} dedupes a send whose reply was lost.
 * The text also goes in knownSentNotes, so a 409 against it is a no-op.
 */
function restampNotes(draft: PendingMutation, atMs: number): PendingMutation {
  const text = notesTextOf(draft) ?? "";
  const known = [...(draft.knownSentNotes || [])];
  if (!known.includes(text)) known.push(text);
  return {
    ...draft,
    createdAt: new Date(atMs).toISOString(),
    knownSentNotes: known.slice(-KNOWN_SENT_LIMIT),
  };
}

/**
 * Notes only. Server time comes from the Date header of the last route
 * response. An actionAt more than 10 minutes ahead of that time is clamped
 * to server time minus 30 seconds before the first send. With no Date header
 * yet, the original actionAt is sent and a 400 field=actionAt restamps once.
 * An actionAt more than 25 days back is re-stamped to local now before sending.
 * Both keep the draft id. Knocks are unchanged.
 */
function stampNotesActionAt(
  draft: PendingMutation,
  nowMs: number,
): { draft: PendingMutation; stale: boolean } {
  if (draft.kind !== "notes") return { draft, stale: false };
  const at = Date.parse(draft.createdAt || "");
  if (!Number.isFinite(at)) return { draft, stale: false };
  if (lastServerNowMs != null && at > lastServerNowMs + ACTION_AT_FUTURE_MS) {
    return { draft: restampNotes(draft, lastServerNowMs - ACTION_AT_SERVER_LAG_MS), stale: false };
  }
  if (nowMs - at > ACTION_AT_STALE_MS) {
    return { draft: restampNotes(draft, nowMs), stale: true };
  }
  return { draft, stale: false };
}

function terminalNotesFailure(error: unknown, draft?: PendingMutation): boolean {
  if (draft?.kind !== "notes") return false;
  if ((error as { notesPending?: boolean }).notesPending) return true; // V4 pending: rethrow, never a plain patch
  const code = (error as { reasonCode?: string }).reasonCode;
  if (code === SYNC_REASON.notesTooLong || code === SYNC_REASON.notesRejected) return true;
  return code === SYNC_REASON.notesConflict && deliberateNotesClear(draft);
}

/** NOTES-MERGE-SPEC E1/G1: a notes draft sends its text with edge blank lines trimmed ("\nC1" is sent as "C1"). */
function trimmedNotesDraft(draft: PendingMutation): PendingMutation {
  if (draft.kind !== "notes" || deliberateNotesClear(draft)) return draft;
  const notes = typeof draft.notes === "string" ? draft.notes : "";
  const composed = notesAgainstBase(draft.baseNotes || "", notes);
  if (composed === notes) return draft;
  return {
    ...draft,
    notes: composed,
    ...(draft.direct ? { direct: { ...draft.direct, patch: { ...draft.direct.patch, notes: composed } } } : {}),
  };
}

function notesCharsTooLong(draft: PendingMutation): boolean {
  if (draft.kind !== "notes") return false;
  return (draft.notes || "").length > NOTES_MAX_CHARS || (draft.baseNotes || "").length > NOTES_MAX_CHARS;
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

function hotHold(status: number): Error {
  return Object.assign(Error("Hot lead route is not ready. This save stays queued."), {
    status,
    code: "hot-leads-hold",
  });
}

function ownedHotMessage(name: unknown): string {
  return typeof name === "string" && name.trim()
    ? `${HOT_LEAD_OWNED_MESSAGE} (${name.trim()})`
    : HOT_LEAD_OWNED_MESSAGE;
}

/** Claim, knock and notes for a hot lead. Never a direct leads, contact or photo write. */
async function deliverHotLead(
  m: PendingMutation,
  user: User,
  deps: FieldDispoDeps,
): Promise<{ replayed: boolean; lead?: Lead; notice?: string }> {
  if (m.kind === "claim") return postHotClaim(m, user, deps);
  if (m.kind !== "knock" && m.kind !== "notes") {
    throw routeError(HOT_LEAD_OLD_SERVER_NOTICE, 400, SYNC_REASON.invalidPayload);
  }
  try {
    return await postFieldDispo(m, user, deps);
  } catch (error) {
    const failure = error as Error & { status?: number; code?: string };
    const status = failure.status || 0;
    if (failure.code === "hot-leads-hold") throw failure;
    if (status === 404 && (failure as { reasonCode?: string }).reasonCode === SYNC_REASON.notFound) throw failure;
    if (status === 404 || failure.code === FIELD_DISPO_UNAVAILABLE || status === 405 || status >= 500) {
      throw hotHold(status >= 500 ? status : status === 405 ? 405 : 404);
    }
    throw failure;
  }
}

async function postHotClaim(
  m: PendingMutation,
  user: User,
  deps: FieldDispoDeps,
): Promise<{ replayed: boolean }> {
  const post = deps.post ?? apiFetch;
  const getToken = deps.getToken ?? (async (forceRefresh = false) => {
    const current = auth?.currentUser;
    if (!current) return "";
    return current.getIdToken(forceRefresh);
  });
  const body = hotClaimBody(m);
  if (utf8Bytes(JSON.stringify(body)) > 2048) {
    throw routeError(HOT_LEAD_OLD_SERVER_NOTICE, 400, SYNC_REASON.invalidPayload);
  }
  let token = await getToken(false);
  if (!token) throw Object.assign(Error("Sign in again to sync your work."), { status: 401 });
  const send = (bearer: string) => post(HOT_CLAIM_PATH, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let response = await send(token);
  if (response.status === 401) {
    token = await getToken(true);
    if (!token) throw Object.assign(Error("Sign in again to sync your work."), { status: 401 });
    response = await send(token);
  }
  if (response.status === 200 || response.status === 201) {
    const data = await readJson(response);
    return { replayed: data?.duplicate === true };
  }
  if (response.status === 404) {
    const missingBody = await readJson(response);
    if (hotLeadMissingBody(missingBody)) throw routeError(HOT_LEAD_MISSING_NOTICE, 404, SYNC_REASON.notFound);
    throw hotHold(404);
  }
  if (response.status === 405 || response.status >= 500) throw hotHold(response.status);
  if (response.status === 400) throw routeError(HOT_LEAD_OLD_SERVER_NOTICE, 400, SYNC_REASON.invalidPayload);
  const data = await readJson(response);
  if (response.status === 409) {
    const reason = knownReason(data?.reasonCode);
    if (reason === SYNC_REASON.ownedByOther) {
      throw routeError(ownedHotMessage((data as { claimedByName?: unknown } | null)?.claimedByName), 409, SYNC_REASON.ownedByOther);
    }
    throw routeError("This hot lead could not be saved.", 409, reason || SYNC_REASON.other);
  }
  if (response.status === 403) {
    const reason = knownReason(data?.reasonCode) || SYNC_REASON.other;
    throw routeError(
      reason === SYNC_REASON.ownedByOther ? ownedHotMessage((data as { claimedByName?: unknown } | null)?.claimedByName) : "The hot lead route denied this save.",
      403,
      reason,
    );
  }
  if (response.status === 401) throw Object.assign(Error("Sign in again to sync your work."), { status: 401 });
  if (response.status === 429) {
    throw Object.assign(Error("Hot lead route asked us to wait."), { status: 429 });
  }
  throw hotHold(response.status || 503);
}

/** Firestore first for pins the client can write. Notes keep the baseNotes check there. Handoffs never use this route. */
export async function deliverFieldDispo(
  m: PendingMutation,
  user: User,
  deps: FieldDispoDeps = {},
): Promise<{ replayed: boolean; lead?: Lead; notice?: string }> {
  const commit = deps.commit ?? ((mutation: PendingMutation, actor: User) => commitDirectMutation(
    mutation,
    actor,
    deps.persistDraft ? { persistDraft: deps.persistDraft } as DirectCommitIo : undefined,
  ));
  const prepared = coerceLegacyContactDraft(m);
  const preparedNotes = prepared.kind === "notes" ? notesTextOf(prepared) : undefined;
  if (typeof preparedNotes === "string" && !preparedNotes.trim() && !deliberateNotesClear(prepared))
    throw routeError("Notes were rejected.", 400, SYNC_REASON.notesRejected);
  if (isHotLeadDraft(prepared)) return deliverHotLead(prepared, user, deps);
  if (prepared.kind === "handoff") return commit(prepared, user);
  if (writesContactDirect(prepared)) return commitContactWrite(prepared, user, commit);
  if (prepared.kind === "notes") return postFieldDispo(prepared, user, deps);
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
