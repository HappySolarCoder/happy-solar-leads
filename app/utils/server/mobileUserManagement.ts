import { NextRequest, NextResponse } from "next/server";
import { type DocumentSnapshot } from "firebase-admin/firestore";
import type { adminAuth, adminDb } from "../firebase-admin";

/** No operations in this module read, update, or delete leads/history. */
export function createMobileUserHandlers(deps: {
  adminAuth: typeof adminAuth;
  adminDb: typeof adminDb;
}) {
  const fail = (message: string, status = 400): never => {
    throw Object.assign(new Error(message), { status });
  };
  const activeAdmin = (d: Record<string, unknown> | undefined) =>
    d?.role === "admin" &&
    d.isActive !== false &&
    !d.deleted &&
    !d.deletionPending &&
    d.approved !== false &&
    d.approvalStatus !== "pending";
  const version = (d: DocumentSnapshot) =>
    d.updateTime ? `${d.updateTime.seconds}:${d.updateTime.nanoseconds}` : "";
  const safeId = (id: unknown): id is string =>
    typeof id === "string" && /^[\w-]{1,128}$/.test(id);
  async function actor(req: NextRequest) {
    const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return fail("Sign in again to manage users.", 401);
    let uid: string;
    try {
      uid = (await deps.adminAuth().verifyIdToken(token, true)).uid;
    } catch {
      return fail("Your session expired. Sign in again.", 401);
    }
    const doc = await deps.adminDb().collection("users").doc(uid).get();
    if (!activeAdmin(doc.data()))
      return fail("Only active, approved admins can manage users.", 403);
    return uid;
  }
  function errorResponse(error: unknown, deleting = true) {
    const e = error as { status?: number; message?: string };
    if (!e.status) console.error("[mobile-user-management]", error);
    return NextResponse.json(
      {
        error: e.status
          ? e.message
          : deleting
          ? "Deletion could not finish. The account may be disabled and some territories removed. Retry to finish; pin history is kept."
          : "The user directory is unavailable. Check your connection and retry.",
      },
      { status: e.status || 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  async function GET(req: NextRequest) {
    try {
      const actorId = await actor(req),
        db = deps.adminDb();
      const snap = await db
        .collection("users")
        .select(
          "name",
          "email",
          "role",
          "team",
          "isActive",
          "deleted",
          "deletionPending",
          "approvalStatus"
        )
        .limit(2001)
        .get();
      if (snap.size > 2000)
        fail(
          "This directory exceeds 2,000 users. Contact your administrator before managing it here.",
          409
        );
      return NextResponse.json(
        {
          actorId,
          users: snap.docs.map((d) => ({
            id: d.id,
            name: d.data().name || "Unnamed user",
            email: d.data().email || "",
            role: d.data().role || "",
            team: d.data().team || "",
            isActive: d.data().isActive !== false,
            deleted: !!d.data().deleted,
            deletionPending: !!d.data().deletionPending,
            version: version(d),
          })),
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (e) {
      return errorResponse(e, false);
    }
  }
  async function POST(req: NextRequest) {
    try {
      const actorId = await actor(req),
        db = deps.adminDb(),
        auth = deps.adminAuth();
      let body;
      try {
        body = await req.json();
      } catch {
        return fail("Invalid deletion request.");
      }
      const uid = body?.userId;
      if (
        body?.action !== "delete" ||
        !safeId(uid) ||
        typeof body.version !== "string"
      )
        fail("Choose a user to delete.");
      if (uid === actorId) fail("You cannot delete your own account.", 403);
      const ref = db.collection("users").doc(uid),
        archive = db.collection("deleted_users").doc(uid);
      const state = await db.runTransaction(async (tx) => {
        const admin = await tx.get(db.collection("users").doc(actorId));
        const user = await tx.get(ref),
          old = await tx.get(archive);
        if (!activeAdmin(admin.data()))
          fail("Your admin access changed. Sign in again.", 403);
        if (!user.exists) {
          if (old.data()?.deletionComplete) return { done: true };
          return fail("User not found. Refresh the directory.", 404);
        }
        const d = user.data()!;
        if (d.deletionPending) return { done: false };
        if (version(user) !== body.version)
          fail(
            "This user changed. Refresh the directory before deleting.",
            409
          );
        // Disable assignment immediately. Keep a minimal identity record for audits.
        tx.set(archive, {
          userId: uid,
          name: d.name || "Unnamed user",
          role: d.role || "",
          team: d.team || "",
          deletedBy: actorId,
          deletedAt: new Date().toISOString(),
          deletionComplete: false,
        });
        tx.update(ref, {
          isActive: false,
          deleted: true,
          deletionPending: true,
          deletedBy: actorId,
        });
        return { done: false };
      });
      if (state.done)
        return NextResponse.json({ done: true, removed: 0, replayed: true });
      async function authAction(fn: () => Promise<unknown>) {
        try {
          await fn();
        } catch (e) {
          if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
        }
      }
      await authAction(() => auth.updateUser(uid, { disabled: true }));
      await authAction(() => auth.revokeRefreshTokens(uid));
      // One bounded batch per request; the client explicitly continues the deletion.
      const removed = await db.runTransaction(async (tx) => {
        const admin = await tx.get(db.collection("users").doc(actorId));
        const target = await tx.get(ref);
        if (!activeAdmin(admin.data()))
          fail(
            "Your admin access changed. Another admin must finish this deletion.",
            403
          );
        if (!target.exists || !target.data()?.deletionPending)
          fail("The account changed. Refresh before continuing.", 409);
        const areas = await tx.get(
          db.collection("territories").where("userId", "==", uid).limit(100)
        );
        for (const d of areas.docs) {
          tx.set(db.collection("archived_territories").doc(d.id), {
            ...d.data(),
            archived: true,
            updatedAt: new Date().toISOString(),
            updatedBy: actorId,
            archiveReason: "user-deleted",
          });
          tx.delete(d.ref);
        }
        return areas.size;
      });
      if (removed === 100) return NextResponse.json({ done: false, removed });
      // Never report success or remove the profile when Auth deletion fails.
      await authAction(() => auth.deleteUser(uid));
      await db.runTransaction(async (tx) => {
        const admin = await tx.get(db.collection("users").doc(actorId));
        const user = await tx.get(ref);
        if (!activeAdmin(admin.data()))
          fail(
            "Your admin access changed. Another admin must finish this deletion.",
            403
          );
        if (user.exists && !user.data()?.deletionPending)
          fail("The account changed. Refresh before continuing.", 409);
        if (user.exists) tx.delete(ref);
        tx.update(archive, {
          deletionComplete: true,
          completedAt: new Date().toISOString(),
        });
      });
      return NextResponse.json({ done: true, removed });
    } catch (e) {
      return errorResponse(e);
    }
  }
  return { GET, POST };
}
