import { NextRequest, NextResponse } from "next/server";
import type { adminAuth, adminDb } from "../firebase-admin";
import { DEFAULT_DISPOSITIONS } from "@/app/types/disposition";
import { cleanConfig } from "@/app/field/config";
import { localParts, pilotFlags } from "@/app/field/analysis";
import {
  isProximityRequired,
  PROXIMITY_MAX_DISTANCE_METERS,
} from "../proximityEnforcement";
import type { FieldMutation, FieldObservation } from "@/app/field/types";

export function fieldFail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
export const activeFieldUser = (d: Record<string, unknown> | undefined) =>
  !!d &&
  ["admin", "manager", "setter", "closer", "sales"].includes(String(d.role)) &&
  d.isActive !== false &&
  !d.deleted &&
  !d.deletionPending &&
  d.approved !== false &&
  d.approvalStatus !== "pending";
export const fieldId = (x: unknown): x is string =>
  typeof x === "string" && /^[\w-]{1,128}$/.test(x);
export const fieldJson = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export function fieldError(e: unknown) {
  const x = e as { status?: number; message?: string };
  if (!x.status) console.error("[field-work]", e);
  return fieldJson(
    {
      error: x.status
        ? x.message
        : "Field service unavailable. Your queued work stays on this device.",
    },
    x.status || 503,
  );
}
export function fieldAuth(deps: { adminAuth: typeof adminAuth }) {
  return async (req: NextRequest) => {
    const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return fieldFail("Sign in to use field tools.", 401);
    try {
      return (await deps.adminAuth().verifyIdToken(token, true)).uid;
    } catch {
      return fieldFail("Your session expired. Sign in again.", 401);
    }
  };
}
const cleanText = (x: unknown, max: number) =>
  typeof x === "string" ? x.slice(0, max) : "";
const distance = (a: number, b: number, c: number, d: number) => {
  const r = Math.PI / 180,
    s =
      Math.sin(((c - a) * r) / 2) ** 2 +
      Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};

export function createFieldHandlers(deps: {
  adminAuth: typeof adminAuth;
  adminDb: typeof adminDb;
  now?: () => Date;
}) {
  const actor = fieldAuth(deps),
    now = () => deps.now?.() || new Date();
  async function GET(req: NextRequest) {
    try {
      const uid = await actor(req),
        db = deps.adminDb();
      const u = await db.collection("users").doc(uid).get();
      if (!activeFieldUser(u.data()))
        fieldFail("This account is not active.", 403);
      return fieldJson({ ready: true, version: 11 });
    } catch (e) {
      return fieldError(e);
    }
  }
  async function POST(req: NextRequest) {
    try {
      const uid = await actor(req),
        raw = await req.text();
      if (raw.length > 30000) fieldFail("This field update is too large.", 413);
      let m: FieldMutation;
      try {
        m = JSON.parse(raw);
      } catch {
        return fieldFail("Invalid field update.");
      }
      if (
        !m ||
        !fieldId(m.id) ||
        !fieldId(m.leadId) ||
        m.userId !== uid ||
        !["knock", "notes", "handoff"].includes(m.kind)
      )
        fieldFail("Invalid field update.");
      const db = deps.adminDb(),
        ref = db.collection("leads").doc(m.leadId),
        at = new Date(m.createdAt),
        serverNow = now();
      if (
        !Number.isFinite(at.getTime()) ||
        at.getTime() > serverNow.getTime() + 5 * 60000 ||
        serverNow.getTime() - at.getTime() > 7 * 86400000
      )
        fieldFail(
          "This draft is over seven days old or has an invalid clock. Review it before logging a new visit.",
          409,
        );
      const result = await db.runTransaction(async (tx) => {
        const actorSnap = await tx.get(db.collection("users").doc(uid)),
          leadSnap = await tx.get(ref),
          configSnap = await tx.get(db.collection("field_settings").doc("v11"));
        const u = actorSnap.data(),
          l = leadSnap.data();
        if (!activeFieldUser(u)) fieldFail("This account is not active.", 403);
        if (!l || l.historicalTerritoryPin)
          fieldFail("This door is no longer available.", 404);
        const owner = l.claimedBy || l.assignedTo || l.setterId;
        let allowed = u!.role === "admin" || owner === uid;
        if (!allowed && u!.role === "manager" && fieldId(owner)) {
          const ownerSnap = await tx.get(db.collection("users").doc(owner));
          allowed = !!u!.team && ownerSnap.data()?.team === u!.team;
        }
        if (!allowed)
          fieldFail(
            "This door is no longer assigned to you or your team. The draft is retained for review.",
            403,
          );
        const cfg = cleanConfig(configSnap.data()),
          pilot = pilotFlags(cfg, uid);
        if (!pilot.flags.capture)
          fieldFail(
            "Field capture is paused for this account. Ask an admin to review this draft.",
            409,
          );
        const history = Array.isArray(l.dispositionHistory)
          ? l.dispositionHistory
          : [];
        const ledger = Array.isArray(l.fieldMutations) ? l.fieldMutations : [];
        if (
          ledger.some((x) => x.id === m.id) ||
          history.some((x) => x.field?.eventId === m.id)
        )
          return { ok: true, replayed: true };
        const recent = ledger.filter(
          (x) => serverNow.getTime() - Date.parse(x.at) < 8 * 86400000,
        );
        if (recent.length >= 300)
          fieldFail(
            "This door has too many recent updates. Ask an admin to review it.",
            409,
          );
        const patch: Record<string, unknown> = {
          fieldMutations: [
            ...recent,
            { id: m.id, at: serverNow.toISOString() },
          ],
        };
        if (m.kind === "notes") {
          if (
            typeof m.notes !== "string" ||
            m.notes.length > 10000 ||
            typeof m.baseNotes !== "string"
          )
            fieldFail("Notes must be under 10,000 characters.");
          if ((l.notes || "") !== m.baseNotes)
            fieldFail(
              "Notes changed on another device. Copy your draft, then refresh and merge it.",
              409,
            );
          patch.notes = m.notes;
        } else if (m.kind === "handoff") {
          if (!pilot.flags.show) fieldFail("Handoff tracking is paused.", 409);
          if (
            !["sent", "acknowledged", "callback", "closed"].includes(
              m.handoff || "",
            )
          )
            fieldFail(
              "Choose a valid handoff state. Booking is confirmed through appointment outcomes.",
            );
          if (m.handoff !== "sent" && !["admin", "manager"].includes(u!.role))
            fieldFail(
              "Only a manager can acknowledge or close a handoff.",
              403,
            );
          if (
            l.fieldHandoff?.updatedAt &&
            Date.parse(l.fieldHandoff.updatedAt) > at.getTime()
          )
            fieldFail("The handoff changed. Refresh it before updating.", 409);
          const old = l.fieldHandoff || {};
          patch.fieldHandoff = {
            ...old,
            state: m.handoff,
            updatedAt: at.toISOString(),
            updatedBy: uid,
            setterId: old.setterId || uid,
            ...(m.handoff === "sent" ? { sentAt: at.toISOString() } : {}),
            ...(m.callbackAt && Number.isFinite(Date.parse(m.callbackAt))
              ? { callbackAt: m.callbackAt }
              : {}),
          };
        } else {
          if (
            typeof m.status !== "string" ||
            !fieldId(m.status) ||
            ["claimed", "unclaimed"].includes(m.status)
          )
            fieldFail("Use the existing assignment tool to change ownership.");
          if (l.status !== m.baseStatus)
            fieldFail(
              "This pin changed while you were offline. Review the current outcome before saving.",
              409,
            );
          if (
            l.fieldDoor?.doNotKnock ||
            /^(do-not-knock|do-not-contact|dnc|dnk)$/.test(l.status || "")
          )
            fieldFail("This address is marked do not knock.", 409);
          const ds = await tx.get(db.collection("dispositions").doc(m.status));
          const d =
            ds.data() || DEFAULT_DISPOSITIONS.find((x) => x.id === m.status);
          if (!d) fieldFail("This disposition is no longer available.", 409);
          const rawObservation = m.observation || ({} as FieldObservation);
          const zone = cleanText(rawObservation.timeZone, 80),
            parts = localParts(at, zone);
          if (!Number.isFinite(parts.hour) || parts.day < 0)
            fieldFail("The phone timezone is invalid.");
          const f: FieldObservation = {
            eventId: m.id,
            statusId: m.status,
            countsAsKnock: !!d!.countsAsDoorKnock,
            timeZone: zone,
            localHour: parts.hour,
            localDay: parts.day,
            flags: pilot.flags,
            experiment: cfg.experiment,
            group: pilot.group,
          };
          if (l.fieldDoor?.territoryId) f.territoryId = l.fieldDoor.territoryId;
          if (typeof rawObservation.answered === "boolean")
            f.answered = rawObservation.answered;
          if (
            f.answered === true &&
            ["short", "45s-plus"].includes(rawObservation.conversation || "")
          )
            f.conversation = rawObservation.conversation;
          if (
            pilot.flags.pitch &&
            cfg.openers.some((x) => x.id === rawObservation.openerId)
          )
            f.openerId = rawObservation.openerId;
          if (pilot.flags.pitch && Array.isArray(rawObservation.objections))
            f.objections = rawObservation.objections
              .filter((x) => typeof x === "string")
              .slice(0, 5)
              .map((x) => x.slice(0, 80));
          if (pilot.flags.preview && rawObservation.previewShown === true)
            f.previewShown = true;
          if (pilot.flags.proof && rawObservation.proofShown === true)
            f.proofShown = true;
          const gps = rawObservation.gps;
          const validGps =
            gps &&
            Number.isFinite(gps.lat) &&
            Math.abs(gps.lat) <= 90 &&
            Number.isFinite(gps.lng) &&
            Math.abs(gps.lng) <= 180 &&
            Number.isFinite(gps.accuracy) &&
            gps.accuracy >= 0 &&
            Math.abs(Date.parse(gps.timestamp) - at.getTime()) < 2 * 60000;
          const hasLocation = Number.isFinite(l.lat) && Number.isFinite(l.lng);
          const dist =
            validGps && hasLocation
              ? distance(gps.lat, gps.lng, l.lat, l.lng)
              : undefined;
          if (
            d!.countsAsDoorKnock &&
            isProximityRequired(
              u as Parameters<typeof isProximityRequired>[0],
            ) &&
            (!validGps ||
              !hasLocation ||
              dist! > PROXIMITY_MAX_DISTANCE_METERS ||
              gps!.accuracy > 100)
          )
            fieldFail(
              "Location could not verify this knock within 50 meters of the door. The draft is kept for review.",
              409,
            );
          if (validGps) {
            f.gps = {
              lat: gps.lat,
              lng: gps.lng,
              accuracy: gps.accuracy,
              timestamp: gps.timestamp,
              ...(dist !== undefined ? { distance: dist } : {}),
            };
            Object.assign(patch, {
              knockGpsLat: gps.lat,
              knockGpsLng: gps.lng,
              knockGpsAccuracy: gps.accuracy,
              knockGpsTimestamp: new Date(gps.timestamp),
              ...(dist !== undefined ? { knockDistanceFromAddress: dist } : {}),
            });
          }
          Object.assign(patch, {
            status: m.status,
            disposition: d!.name,
            dispositionedAt: at,
            dispositionHistory: [
              {
                disposition: d!.name,
                timestamp: at,
                userId: uid,
                userName: cleanText(u!.name, 150),
                field: f,
              },
              ...history,
            ],
          });
          if (m.status === "not-interested")
            Object.assign(patch, {
              objectionType: cleanText(m.objectionType, 80),
              objectionNotes: cleanText(m.objectionNotes, 1000),
              objectionRecordedAt: at,
              objectionRecordedBy: uid,
            });
          if (["go-back", "house-for-sale"].includes(m.status)) {
            if (
              !m.goBackScheduledDate ||
              !Number.isFinite(Date.parse(m.goBackScheduledDate)) ||
              !/^\d{2}:\d{2}$/.test(m.goBackScheduledTime || "")
            )
              fieldFail("Choose a valid return date and time.");
            Object.assign(patch, {
              goBackScheduledDate: new Date(m.goBackScheduledDate),
              goBackScheduledTime: m.goBackScheduledTime,
              goBackNotes: cleanText(m.goBackNotes, 1000),
              goBackScheduledBy: uid,
              goBackScheduledAt: at,
            });
          }
        }
        tx.update(ref, patch);
        return { ok: true, replayed: false };
      });
      return fieldJson(result);
    } catch (e) {
      return fieldError(e);
    }
  }
  return { GET, POST };
}
