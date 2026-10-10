import { NextRequest } from "next/server";
import type { adminAuth, adminDb } from "../firebase-admin";
import { cleanConfig } from "@/app/field/config";
import {
  activeFieldUser,
  fieldAuth,
  fieldError,
  fieldFail,
  fieldJson,
} from "./fieldWork";
export function createFieldConfigHandlers(deps: {
  adminAuth: typeof adminAuth;
  adminDb: typeof adminDb;
}) {
  const actor = fieldAuth(deps);
  async function GET(req: NextRequest) {
    try {
      const uid = await actor(req),
        db = deps.adminDb();
      const u = await db.collection("users").doc(uid).get();
      if (!activeFieldUser(u.data()))
        fieldFail("This account is not active.", 403);
      const c = await db.collection("field_settings").doc("v11").get();
      return fieldJson({ config: cleanConfig(c.data()) });
    } catch (e) {
      return fieldError(e);
    }
  }
  async function POST(req: NextRequest) {
    try {
      const uid = await actor(req),
        db = deps.adminDb(),
        raw = await req.text();
      if (raw.length > 60000) fieldFail("Settings are too large.", 413);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return fieldFail("Invalid settings.");
      }
      const c = cleanConfig(body.config);
      const result = await db.runTransaction(async (tx) => {
        const u = await tx.get(db.collection("users").doc(uid)),
          ref = db.collection("field_settings").doc("v11"),
          old = await tx.get(ref);
        if (!activeFieldUser(u.data()) || u.data()?.role !== "admin")
          fieldFail("Only an active admin can change field tools.", 403);
        if (cleanConfig(old.data()).version !== body.version)
          fieldFail(
            "Another admin changed these settings. Reload before saving.",
            409,
          );
        const config = { ...c, version: crypto.randomUUID() };
        tx.set(ref, config);
        return config;
      });
      return fieldJson({ config: result });
    } catch (e) {
      return fieldError(e);
    }
  }
  return { GET, POST };
}
