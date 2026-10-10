import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { type DocumentSnapshot } from "firebase-admin/firestore";
import type { adminAuth, adminDb } from "../firebase-admin";
import {
  MAX_TERRITORY_LEADS,
  MAX_TERRITORY_SCAN,
  assignableTerritoryLead,
  inManagerTeam,
  insideTerritory,
  mayManageTerritories,
  mayReceiveTerritory,
  polygonsOverlap,
  territoryBounds,
  validateTerritoryPolygon,
  type TerritoryMember,
} from "@/app/utils/territoryManager";

export function createTerritoryHandlers(dependencies: {
  adminAuth: typeof adminAuth;
  adminDb: typeof adminDb;
}) {
  const { adminAuth, adminDb } = dependencies;
  const fail = (message: string, status = 400): never => {
    throw Object.assign(new Error(message), { status });
  };
  const version = (doc: DocumentSnapshot) =>
    doc.updateTime
      ? `${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`
      : "";
  function member(doc: DocumentSnapshot): TerritoryMember {
    const d = doc.data() || {};
    return {
      id: doc.id,
      name: d.name || "Unnamed rep",
      color: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : "#587E98",
      role: d.role,
      team: d.team,
      isActive: d.isActive,
      approved: d.approved,
      approvalStatus: d.approvalStatus,
    };
  }
  async function actorFor(req: NextRequest) {
    const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token) fail("Sign in again to manage territories.", 401);
    let uid: string;
    try {
      uid = (await adminAuth().verifyIdToken(token!, true)).uid;
    } catch {
      return fail("Your session expired. Sign in again.", 401);
    }
    const actor = member(await adminDb().collection("users").doc(uid).get());
    if (!mayManageTerritories(actor))
      fail("Only approved managers and admins can manage territories.", 403);
    return actor;
  }
  function errorResponse(error: unknown) {
    const e = error as { status?: number; message?: string };
    if (!e.status) console.error("[territory-management]", error);
    return NextResponse.json(
      {
        error: e.status
          ? e.message
          : "Territories could not be saved. Check your connection and retry.",
      },
      { status: e.status || 500, headers: { "Cache-Control": "no-store" } }
    );
  }
  function serialize(doc: DocumentSnapshot) {
    const d = doc.data()!;
    return {
      id: doc.id,
      name: d.name || `${d.userName || "Rep"}’s area`,
      userId: d.userId,
      userName: d.userName,
      userColor: d.userColor || "#587E98",
      polygon: d.polygon || [],
      leadIds: d.leadIds || [],
      version: version(doc),
    };
  }
  async function GET(req: NextRequest) {
    try {
      const actor = await actorFor(req),
        db = adminDb();
      const [people, areas] = await Promise.all([
        db.collection("users").get(),
        db.collection("territories").limit(501).get(),
      ]);
      if (areas.size > 500)
        fail(
          "This workspace has more than 500 areas. Ask an admin to reduce the number of active areas before loading this editor.",
          409
        );
      const allMembers = people.docs.map(member);
      const scope = new Set(
        allMembers.filter((m) => inManagerTeam(actor, m)).map((m) => m.id)
      );
      return NextResponse.json(
        {
          actor,
          members: allMembers.filter((m) => scope.has(m.id)),
          territories: areas.docs
            .filter((d) => !d.data().archived && scope.has(d.data().userId))
            .map(serialize),
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (error) {
      return errorResponse(error);
    }
  }
  async function POST(req: NextRequest) {
    try {
      const actor = await actorFor(req),
        db = adminDb();
      let body;
      try {
        body = await req.json();
      } catch {
        return fail("Invalid request.");
      }
      const action = body?.action;
      if (
        !["preview", "create", "rename", "transfer", "archive"].includes(action)
      )
        fail("Unknown territory action.");
      if (action === "preview") {
        let polygon;
        try {
          polygon = validateTerritoryPolygon(body.polygon);
        } catch (e) {
          return fail((e as Error).message);
        }
        if (typeof body.userId !== "string") fail("Choose a rep.");
        const target = member(
          await db.collection("users").doc(body.userId).get()
        );
        if (!inManagerTeam(actor, target) || !mayReceiveTerritory(target))
          fail("Choose an active, approved rep on your team.", 403);
        const bounds = territoryBounds(polygon);
        // One bounded, explicit preview; no background listener or reads on map movement.
        // Latitude uses the existing single-field index, without a new paid map service.
        const snap = await db
          .collection("leads")
          .where("lat", ">=", bounds.south)
          .where("lat", "<=", bounds.north)
          .limit(MAX_TERRITORY_SCAN + 1)
          .select(
            "lat",
            "lng",
            "status",
            "assignedTo",
            "claimedBy",
            "leadType",
            "source",
            "setterId",
            "appointmentOutcome",
            "ghlStatus",
            "dispositionedAt",
            "dispositionHistory"
          )
          .get();
        const matching = snap.docs.filter((d) =>
          insideTerritory(d.data().lat, d.data().lng, polygon)
        );
        const candidates = matching.map((d) => ({
          id: d.id,
          lat: d.data().lat,
          lng: d.data().lng,
          version: version(d),
          eligible: assignableTerritoryLead(d.data(), target.id),
        }));
        const eligible = candidates.filter((d) => d.eligible).length;
        return NextResponse.json({
          candidates,
          eligible,
          skipped: candidates.length - eligible,
          truncated:
            snap.size > MAX_TERRITORY_SCAN || eligible > MAX_TERRITORY_LEADS,
        });
      }
      if (
        typeof body.requestId !== "string" ||
        !/^[\da-f-]{36}$/i.test(body.requestId)
      )
        fail("Invalid save request.");
      const id = action === "create" ? body.requestId : body.id;
      if (typeof id !== "string" || !/^[\w-]{1,128}$/.test(id))
        fail("Choose a saved territory.");
      const ref = db.collection("territories").doc(id);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(body))
        .digest("hex");
      const result = await db.runTransaction(async (tx) => {
        // Auth and team scope are checked again inside the transaction, so a role
        // change or owner transfer during review cannot bypass authorization.
        const freshActor = member(
          await tx.get(db.collection("users").doc(actor.id))
        );
        if (!mayManageTerritories(freshActor))
          fail(
            "Your territory permissions changed. Refresh and try again.",
            403
          );
        const existing = await tx.get(ref),
          data = existing.data();
        if (!existing.exists && action === "archive") {
          const archived = await tx.get(
            db.collection("archived_territories").doc(id)
          );
          const saved = archived.data();
          if (
            saved?.lastOperation === body.requestId &&
            saved?.lastOperationBy === actor.id &&
            saved?.lastOperationHash === fingerprint
          )
            return { id, changed: 0, replayed: true };
        }
        if (
          data?.lastOperation === body.requestId &&
          data?.lastOperationBy === actor.id &&
          data?.lastOperationHash === fingerprint
        )
          return { id, changed: data.lastChangedCount || 0, replayed: true };
        if (action === "create" && existing.exists)
          fail("This area already exists. Refresh your list.", 409);
        if (action !== "create" && (!existing.exists || data?.archived))
          fail("This area is no longer available. Refresh your list.", 409);
        if (action !== "create" && body.version !== version(existing))
          fail(
            "Someone changed this area while you were editing. Refresh before trying again.",
            409
          );
        const targetId =
          action === "create" || action === "transfer"
            ? body.userId
            : data?.userId;
        if (typeof targetId !== "string" || !/^[\w-]{1,128}$/.test(targetId))
          fail("Choose a rep.");
        const target = member(
          await tx.get(db.collection("users").doc(targetId))
        );
        if (!inManagerTeam(freshActor, target))
          fail("You can only manage your team’s territories.", 403);
        if (
          (action === "create" || action === "transfer") &&
          !mayReceiveTerritory(target)
        )
          fail("Choose an active, approved rep.", 403);
        if (existing.exists) {
          const oldOwner = member(
            await tx.get(db.collection("users").doc(data!.userId))
          );
          if (!inManagerTeam(freshActor, oldOwner))
            fail("This territory belongs to another team.", 403);
        }
        const metadata = {
          lastOperation: body.requestId,
          lastOperationBy: actor.id,
          lastOperationHash: fingerprint,
          updatedAt: new Date().toISOString(),
          updatedBy: actor.id,
        };
        if (action === "archive") {
          // Removing a boundary never deletes or unassigns a prospect.
          tx.set(db.collection("archived_territories").doc(id), {
            ...data,
            ...metadata,
            archived: true,
            lastChangedCount: 0,
          });
          tx.delete(ref);
          return { id, changed: 0 };
        }
        const name =
          typeof body.name === "string" ? body.name.trim() : data?.name;
        if (
          (action === "create" || action === "rename") &&
          (!name || name.length > 60)
        )
          fail("Give this area a name of 1–60 characters.");
        if (action === "rename") {
          tx.update(ref, { ...metadata, name, lastChangedCount: 0 });
          return { id, changed: 0 };
        }
        let polygon;
        try {
          polygon = validateTerritoryPolygon(
            action === "create" ? body.polygon : data?.polygon
          );
        } catch (e) {
          return fail((e as Error).message);
        }
        if (action === "create") {
          const areas = await tx.get(db.collection("territories").limit(501));
          if (areas.size > 500)
            fail("Ask an admin to archive old boundaries first.", 409);
          if (
            areas.docs.some(
              (d) =>
                !d.data().archived &&
                Array.isArray(d.data().polygon) &&
                polygonsOverlap(polygon, d.data().polygon)
            )
          )
            fail(
              "This boundary overlaps a saved area. Adjust it so reps have clear territories.",
              409
            );
        }
        const candidates: { id: string; version?: string }[] =
          action === "create"
            ? body.candidates
            : (data?.leadIds || []).map((leadId: string) => ({ id: leadId }));
        if (
          !Array.isArray(candidates) ||
          candidates.length > MAX_TERRITORY_LEADS ||
          candidates.some(
            (c) => typeof c?.id !== "string" || !/^[\w-]{1,128}$/.test(c.id)
          ) ||
          new Set(candidates.map((c) => c.id)).size !== candidates.length
        )
          fail(
            `Use an area with at most ${MAX_TERRITORY_LEADS} available pins. Split large areas into neighborhoods.`
          );
        const docs = candidates.length
          ? await tx.getAll(
              ...candidates.map((c) => db.collection("leads").doc(c.id))
            )
          : [];
        const changed: string[] = [];
        for (let i = 0; i < docs.length; i++) {
          const doc = docs[i],
            lead = doc.data();
          if (
            action === "create" &&
            (!doc.exists || version(doc) !== candidates[i].version)
          )
            fail(
              "A pin changed since your preview. Review the area again before saving.",
              409
            );
          if (
            !lead ||
            !insideTerritory(lead.lat, lead.lng, polygon) ||
            !assignableTerritoryLead(
              lead,
              target.id,
              action === "transfer" ? data?.userId : undefined
            )
          ) {
            if (action === "create")
              fail("The available pins changed. Review the area again.", 409);
            continue;
          }
          // Transfers only move this boundary’s still-unworked assigned pins.
          if (action === "transfer" && lead.assignedTo !== data?.userId)
            continue;
          tx.update(doc.ref, {
            assignedTo: target.id,
            assignedAt: new Date().toISOString(),
            autoAssigned: false,
            ...(lead.status === "unclaimed" ? { status: "assigned" } : {}),
            ...(lead.assignedTo ? { lastAssignedTo: lead.assignedTo } : {}),
            territoryAssignedBy: actor.id,
            territoryId: id,
          });
          changed.push(doc.id);
        }
        const update = {
          ...metadata,
          name: name || `${target.name}’s area`,
          userId: target.id,
          userName: target.name,
          userColor: target.color,
          polygon,
          leadIds: changed,
          lastChangedCount: changed.length,
        };
        if (action === "create")
          tx.create(ref, {
            ...update,
            createdAt: new Date().toISOString(),
            createdBy: actor.id,
          });
        else tx.update(ref, update);
        return {
          id,
          changed: changed.length,
          skipped: docs.length - changed.length,
        };
      });
      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      return errorResponse(error);
    }
  }

  return { GET, POST };
}
