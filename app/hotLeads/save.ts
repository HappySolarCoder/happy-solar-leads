import type { Lead, User } from "@/app/types";
import { GPS_WINDOW_AFTER_MS } from "@/app/field/gpsPolicy";
import type { FieldMutation, PendingMutation } from "@/app/field/types";
import { canSeeHotLeads, type HotLeadProfile } from "./access";
import { HOT_LEADS_ENABLED } from "./flag";
import { HOT_LEAD_ID, type HotLeadPin } from "./model";

export const HOT_CLAIM_PATH = "/api/hot-leads/claim";
export const HOT_LEAD_COLLECTION = "hotLeads" as const;
/** Parked where the rep can see it. The draft is not deleted. */
export const HOT_LEAD_OLD_SERVER_NOTICE = "This hot lead is saved on this phone. The server does not accept it yet.";
/** A 404 for this hot lead parks. It is not retried forever. */
export const HOT_LEAD_MISSING_NOTICE = "This hot lead is no longer available.";
export const HOT_LEAD_OWNED_MESSAGE = "This hot lead belongs to someone else.";
/** Hot saves never ask the area gate or the proximity warning. */
export const HOT_LEAD_AREA_GATE = false;
export const HOT_LEAD_PROXIMITY_WARNING = false;
export const HOT_LEAD_DIRECT_WRITE = false;
/** The disposition route does not accept photo or contact edits. */
export const HOT_LEAD_ROUTE_SUPPORTS_CONTACT = false;
export const HOT_LEAD_ROUTE_SUPPORTS_PHOTO = false;

export function isHotLeadDraft(m: { collection?: string; kind?: string } | null | undefined): boolean {
  return !!m && (m.collection === HOT_LEAD_COLLECTION || m.kind === "claim");
}

export function hotLeadEditors(): { contact: false; photo: false } {
  return { contact: false, photo: false };
}

type SaveInput = {
  enabled?: boolean;
  user: HotLeadProfile | User;
  pin: HotLeadPin;
  draftId: string;
  tappedAt: Date;
};

function allowed(input: SaveInput): boolean {
  const enabled = input.enabled ?? HOT_LEADS_ENABLED;
  return enabled && canSeeHotLeads(input.user) && HOT_LEAD_ID.test(input.pin.id);
}

export function queueHotKnock(input: SaveInput & {
  status: string;
  disposition: string;
  gps?: { lat: number; lng: number; accuracyM: number; capturedAt: string } | null;
}): FieldMutation | null {
  if (!allowed(input) || !input.status || input.status === "claimed" || input.status === "unclaimed") return null;
  const patch: Partial<Lead> = {
    status: input.status,
    disposition: input.disposition,
    dispositionedAt: input.tappedAt,
    dispositionHistory: [{
      disposition: input.disposition,
      timestamp: input.tappedAt,
      userId: input.user.id,
      userName: input.user.name,
    }],
  };
  if (input.gps && [input.gps.lat, input.gps.lng, input.gps.accuracyM].every((n) => Number.isFinite(n))) {
    patch.knockGpsLat = input.gps.lat;
    patch.knockGpsLng = input.gps.lng;
    patch.knockGpsAccuracy = input.gps.accuracyM;
    patch.knockGpsTimestamp = new Date(input.gps.capturedAt);
  }
  return {
    id: input.draftId,
    userId: input.user.id,
    userName: input.user.name,
    leadId: input.pin.id,
    createdAt: input.tappedAt.toISOString(),
    kind: "knock",
    collection: HOT_LEAD_COLLECTION,
    baseStatus: input.pin.status || "",
    baseNotes: input.pin.notes || "",
    status: input.status,
    disposition: input.disposition,
    direct: {
      patch,
      gps: {
        lat: input.pin.lat,
        lng: input.pin.lng,
        tappedAt: input.tappedAt.getTime(),
        deadline: input.tappedAt.getTime() + GPS_WINDOW_AFTER_MS,
        required: false,
      },
    },
  };
}

export function queueHotNotes(input: SaveInput & {
  notes: string;
  baseNotes: string;
  clearNotes?: boolean;
}): FieldMutation | null {
  if (!allowed(input)) return null;
  const clearing = input.clearNotes === true && input.notes === "";
  if (!clearing && !input.notes.trim()) return null;
  const draft: FieldMutation = {
    id: input.draftId,
    userId: input.user.id,
    userName: input.user.name,
    leadId: input.pin.id,
    createdAt: input.tappedAt.toISOString(),
    kind: "notes",
    collection: HOT_LEAD_COLLECTION,
    baseStatus: input.pin.status || "",
    baseNotes: input.baseNotes,
    notes: clearing ? "" : input.notes,
    direct: { patch: { notes: clearing ? "" : input.notes } },
  };
  if (clearing) draft.clearNotes = true;
  return draft;
}

export function queueHotClaim(input: SaveInput & {
  action: "claim" | "release";
}): FieldMutation | null {
  if (!allowed(input)) return null;
  if (input.action !== "claim" && input.action !== "release") return null;
  return {
    id: input.draftId,
    userId: input.user.id,
    userName: input.user.name,
    leadId: input.pin.id,
    createdAt: input.tappedAt.toISOString(),
    kind: "claim",
    collection: HOT_LEAD_COLLECTION,
    claimAction: input.action,
    baseStatus: input.pin.status || "",
  };
}

/** C5 body. Strict keys only. userName is omitted when the rep has no name. */
export function hotClaimBody(m: Pick<PendingMutation, "id" | "leadId" | "createdAt" | "userName" | "claimAction">): {
  draftId: string;
  hotLeadId: string;
  action: "claim" | "release";
  actionAt: string;
  userName?: string;
} {
  if (m.claimAction !== "claim" && m.claimAction !== "release") {
    throw Object.assign(Error("Hot lead claim action is not valid."), { status: 400 });
  }
  const actionAt = new Date(m.createdAt).toISOString();
  if (!Number.isFinite(Date.parse(actionAt)) || !HOT_LEAD_ID.test(m.leadId)) {
    throw Object.assign(Error("Hot lead claim is not valid."), { status: 400 });
  }
  const body: {
    draftId: string;
    hotLeadId: string;
    action: "claim" | "release";
    actionAt: string;
    userName?: string;
  } = {
    draftId: m.id,
    hotLeadId: m.leadId,
    action: m.claimAction,
    actionAt,
  };
  if (m.userName) body.userName = m.userName;
  return body;
}

export function hotLeadParkNotice(
  drafts: { collection?: string; kind?: string; syncState?: string; lastError?: string }[] | undefined,
): string | null {
  const hit = (drafts || []).some((row) =>
    isHotLeadDraft(row)
    && row.syncState === "parked"
    && row.lastError === HOT_LEAD_OLD_SERVER_NOTICE
  );
  return hit ? HOT_LEAD_OLD_SERVER_NOTICE : null;
}
