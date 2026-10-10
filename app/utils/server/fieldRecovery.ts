import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { NextRequest } from "next/server";
import type { adminAuth, adminDb } from "../firebase-admin";
import {
  activeFieldUser,
  fieldAuth,
  fieldError,
  fieldFail,
  fieldId,
  fieldJson,
} from "./fieldWork";
import { cleanConfig } from "@/app/field/config";
import { pilotFlags } from "@/app/field/analysis";
type Ticket = {
  leadId: string;
  setterId: string;
  expires: number;
  name: string;
  city: string;
  state: string;
};
export function sealTicket(ticket: Ticket, secret: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      createHash("sha256").update(secret).digest(),
      iv,
    );
  const data = Buffer.concat([
    cipher.update(JSON.stringify(ticket), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function openTicket(
  code: string,
  secret: string,
  now = Date.now(),
): Ticket {
  try {
    if (!/^[\w-]{40,1500}$/.test(code)) throw Error();
    const bytes = Buffer.from(code, "base64url"),
      decipher = createDecipheriv(
        "aes-256-gcm",
        createHash("sha256").update(secret).digest(),
        bytes.subarray(0, 12),
      );
    decipher.setAuthTag(bytes.subarray(12, 28));
    const t = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
    if (
      !fieldId(t.leadId) ||
      !fieldId(t.setterId) ||
      !Number.isFinite(t.expires) ||
      t.expires < now
    )
      throw Error();
    return t;
  } catch {
    return fieldFail("This card has expired or is unavailable.", 410);
  }
}
export function createRecoveryHandlers(deps: {
  adminAuth: typeof adminAuth;
  adminDb: typeof adminDb;
  secret: () => string | undefined;
  enabled: () => boolean;
  now?: () => number;
}) {
  const actor = fieldAuth(deps),
    now = () => deps.now?.() || Date.now();
  // Views share one config read per warm server/minute; no lead read or open-tracking write.
  let cached:
    | { until: number; value: ReturnType<typeof cleanConfig> }
    | undefined;
  async function settings() {
    if (cached && cached.until > now()) return cached.value;
    const s = await deps
      .adminDb()
      .collection("field_settings")
      .doc("v11")
      .get();
    const value = cleanConfig(s.data());
    cached = { until: now() + 60000, value };
    return value;
  }
  function secret() {
    const s = deps.secret();
    if (!deps.enabled() || !s || s.length < 32)
      fieldFail(
        "Recovery cards are not activated. Ask your admin to complete the public-page setup.",
        503,
      );
    return s!;
  }
  async function GET(req: NextRequest) {
    try {
      const t = openTicket(
          req.nextUrl.searchParams.get("code") || "",
          secret(),
          now(),
        ),
        cfg = await settings();
      if (!cfg.enabled.recovery || !pilotFlags(cfg, t.setterId).flags.recovery)
        fieldFail("This card is currently unavailable.", 410);
      return fieldJson({
        name: t.name,
        city: t.city,
        state: t.state,
        expires: t.expires,
        proof: (pilotFlags(cfg, t.setterId).flags.proof ? cfg.proof : [])
          .filter(
            (p) =>
              p.city.toLowerCase() === t.city.toLowerCase() &&
              p.state === t.state,
          )
          .map((p) => ({
            title: p.title,
            quote: p.quote,
            sourceUrl: p.sourceUrl,
          })),
        schedulingPhone: cfg.schedulingPhone,
      });
    } catch (e) {
      return fieldError(e);
    }
  }
  async function POST(req: NextRequest) {
    try {
      const key = secret(),
        raw = await req.text();
      if (raw.length > 3000) fieldFail("Request is too large.", 413);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return fieldFail("Invalid request.");
      }
      const db = deps.adminDb();
      if (body.action === "issue") {
        const uid = await actor(req);
        if (!fieldId(body.leadId)) fieldFail("Choose a door.");
        const [u, l] = await Promise.all([
          db.collection("users").doc(uid).get(),
          db.collection("leads").doc(body.leadId).get(),
        ]);
        const cfg = await settings(),
          lead = l.data();
        if (
          !activeFieldUser(u.data()) ||
          !pilotFlags(cfg, uid).flags.recovery ||
          !cfg.publicOrigin
        )
          fieldFail("Recovery cards are not enabled for this account.", 403);
        if (
          !lead ||
          lead.historicalTerritoryPin ||
          lead.fieldDoor?.doNotKnock ||
          !["not-home", "interested", "follow-up-later", "go-back"].includes(
            lead.status,
          )
        )
          fieldFail(
            "Only eligible not-home or agreed follow-up doors can get a card.",
            409,
          );
        if (
          u.data()?.role !== "admin" &&
          (lead.claimedBy || lead.assignedTo || lead.setterId) !== uid
        )
          fieldFail("This door is not assigned to you.", 403);
        const ticket = {
          leadId: body.leadId,
          setterId: uid,
          expires: now() + 30 * 86400000,
          name: String(u.data()?.name || "our team")
            .split(" ")[0]
            .slice(0, 50),
          city: String(lead.city || "").slice(0, 80),
          state: String(lead.state || "")
            .slice(0, 2)
            .toUpperCase(),
        };
        const code = sealTicket(ticket, key);
        return fieldJson({
          url: `${cfg.publicOrigin}/visit/?code=${code}`,
          expires: ticket.expires,
        });
      }
      const ticket = openTicket(String(body.code || ""), key, now());
      if (
        body.action !== "callback" ||
        body.consent !== true ||
        body.website ||
        typeof body.phone !== "string" ||
        !/^\+?\d[\d ()-]{8,24}$/.test(body.phone) ||
        typeof body.name !== "string" ||
        body.name.length < 1 ||
        body.name.length > 100
      )
        fieldFail(
          "Enter your name, phone number and permission for one callback.",
        );
      const result = await db.runTransaction(async (tx) => {
        const configDoc = await tx.get(
            db.collection("field_settings").doc("v11"),
          ),
          cfg = cleanConfig(configDoc.data()),
          ref = db.collection("leads").doc(ticket.leadId),
          leadSnap = await tx.get(ref),
          setter = await tx.get(db.collection("users").doc(ticket.setterId)),
          lead = leadSnap.data();
        if (req.headers.get("origin") !== cfg.publicOrigin)
          fieldFail("Open the original card to request a callback.", 403);
        if (
          !pilotFlags(cfg, ticket.setterId).flags.recovery ||
          !activeFieldUser(setter.data()) ||
          !lead ||
          lead.historicalTerritoryPin ||
          lead.fieldDoor?.doNotKnock ||
          !["not-home", "interested", "follow-up-later", "go-back"].includes(
            lead.status,
          )
        )
          fieldFail("This card is no longer available.", 410);
        if (
          setter.data()?.role !== "admin" &&
          (lead.claimedBy || lead.assignedTo || lead.setterId) !==
            ticket.setterId
        )
          fieldFail(
            "This card is no longer assigned to the original representative.",
            410,
          );
        const previous = lead.fieldRecovery;
        if (
          previous?.requestedAt &&
          now() - Date.parse(previous.requestedAt) < 24 * 3600000
        )
          return { ok: true, alreadyRequested: true };
        if ((lead.fieldRecoveryCount || 0) >= 3)
          fieldFail(
            "Please call our scheduling team to update an earlier request.",
            429,
          );
        tx.update(ref, {
          fieldRecovery: {
            requestedAt: new Date(now()).toISOString(),
            phone: body.phone.replace(/[^+\d]/g, ""),
            name: body.name.trim(),
            consentVersion: "one-callback-v11",
            callbackRequested: true,
            setterId: ticket.setterId,
            consentText:
              "I ask Happy Solar to call me once about a solar consultation. This is not permission for marketing texts.",
          },
          fieldRecoveryCount: (lead.fieldRecoveryCount || 0) + 1,
          fieldHandoff: {
            ...(lead.fieldHandoff || {}),
            state: "callback",
            updatedAt: new Date(now()).toISOString(),
            updatedBy: "homeowner-callback",
            setterId: ticket.setterId,
          },
        });
        return { ok: true, alreadyRequested: false };
      });
      return fieldJson(result);
    } catch (e) {
      return fieldError(e);
    }
  }
  return { GET, POST };
}
