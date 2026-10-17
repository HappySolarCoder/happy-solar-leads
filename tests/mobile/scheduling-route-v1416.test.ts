import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AMBIGUOUS_SEND_MESSAGE,
  NOT_CONFIGURED_MESSAGE,
  SCHEDULING_API_ORIGIN,
  SCHEDULING_BLOCKED_MESSAGE,
  SCHEDULING_ROUTE_PATH,
  SCHEDULING_ROUTE_UNAVAILABLE_MESSAGE,
  SIGN_IN_AGAIN_MESSAGE,
  buildSchedulingPayload,
  resetSchedulingSendBlocksForTests,
  safeServerError,
  schedulingBlockedFor,
  sendSchedulingNotification,
  type SchedulingPayload,
} from "../../app/utils/schedulingNotification";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ALLOWED = [
  "kind", "name", "address", "city", "state", "zip", "phone", "email", "estimatedBill",
  "notes", "solarScore", "solarSunshineHours", "solarMaxPanels", "hasSouthFacingRoof",
];

const form = {
  name: "Ada Lovelace",
  address: "1 Main St",
  city: "Rochester",
  state: "ny",
  zip: "14601",
  phone: "(555) 010-0000",
  email: "",
  estimatedBill: "",
  notes: "",
};

function payloadOf(built: ReturnType<typeof buildSchedulingPayload>): SchedulingPayload {
  assert.equal(built.ok, true);
  if (!built.ok) throw new Error("expected a payload");
  return built.payload;
}

test("scheduling payload keeps only allowed keys and normalizes state, zip, and bill", () => {
  assert.equal(SCHEDULING_API_ORIGIN, "https://happy-solar-leads.vercel.app");
  assert.equal(SCHEDULING_ROUTE_PATH, "/api/notifications/discord");
  const built = payloadOf(buildSchedulingPayload({
    ...form,
    name: "Ada  Lovelace\n",
    state: "ny",
    zip: "146056789",
    email: "  ada@example.com ",
    estimatedBill: " $1,234.50 /mo ",
    notes: "Bring  the bill",
  }, {
    solarScore: 80,
    solarSunshineHours: 1400,
    solarMaxPanels: 22,
    hasSouthFacingRoof: false,
  }));
  assert.equal(built.kind, "scheduling");
  assert.equal(built.name, "Ada  Lovelace");
  assert.equal(built.state, "NY");
  assert.equal(built.zip, "14605-6789");
  assert.equal(built.email, "ada@example.com");
  assert.equal(built.estimatedBill, "1234.50");
  assert.equal(built.notes, "Bring  the bill");
  assert.equal(built.solarScore, 80);
  assert.equal(built.hasSouthFacingRoof, false);
  for (const key of Object.keys(built)) assert.ok(ALLOWED.includes(key), key);
  assert.equal(JSON.stringify(built).includes('"kind":"test"'), false);

  const sparse = payloadOf(buildSchedulingPayload(form, {
    solarScore: "80" as unknown as number,
    solarSunshineHours: Number.NaN,
    solarMaxPanels: 100_001,
    hasSouthFacingRoof: "yes" as unknown as boolean,
  }));
  assert.equal("email" in sparse, false);
  assert.equal("estimatedBill" in sparse, false);
  assert.equal("notes" in sparse, false);
  assert.equal("solarScore" in sparse, false);
  assert.equal("solarSunshineHours" in sparse, false);
  assert.equal("solarMaxPanels" in sparse, false);
  assert.equal("hasSouthFacingRoof" in sparse, false);

  const zero = payloadOf(buildSchedulingPayload({ ...form, estimatedBill: 0 }, { solarScore: 0, hasSouthFacingRoof: true }));
  assert.equal(zero.estimatedBill, "0");
  assert.equal(zero.solarScore, 0);
  assert.equal(zero.hasSouthFacingRoof, true);

  const spacedZip = payloadOf(buildSchedulingPayload({ ...form, zip: "14605 6789" }));
  assert.equal(spacedZip.zip, "14605-6789");
});

test("scheduling payload lists every invalid field and appends field context only when it fits", () => {
  const missing = buildSchedulingPayload({
    name: " ",
    address: "",
    city: "x".repeat(81),
    state: "New York",
    zip: "1460",
    phone: "",
    email: "e".repeat(121),
    notes: "n".repeat(801),
    estimatedBill: "nope",
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.message, "Fix these before sending: Name (1–120 characters), Street address (1–200 characters), City (1–80 characters), State (2 letters), ZIP (5 digits or ZIP+4), Phone (1–40 characters), Email (120 characters or fewer), Notes (800 characters or fewer), Estimated bill (up to 1,000,000)");
  }
  const huge = buildSchedulingPayload({ ...form, estimatedBill: "1000001" });
  assert.equal(huge.ok, false);
  if (!huge.ok) assert.match(huge.message, /Estimated bill/);

  const notes = "n".repeat(800);
  const kept = payloadOf(buildSchedulingPayload({ ...form, notes }, null, "gate code 1234"));
  assert.equal(kept.notes, notes);
  assert.equal(kept.notes?.includes("Field context:"), false);

  const appended = payloadOf(buildSchedulingPayload({ ...form, notes: "Dog in yard" }, null, "gate code"));
  assert.equal(appended.notes, "Dog in yard\nField context: gate code");

  const onlyContext = payloadOf(buildSchedulingPayload(form, null, "gate code"));
  assert.equal(onlyContext.notes, "Field context: gate code");

  const tooLongContext = payloadOf(buildSchedulingPayload(form, null, "c".repeat(800)));
  assert.equal("notes" in tooLongContext, false);
});

function jsonResponse(status: number, body?: unknown, headers?: Record<string, string>): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

const sample = (): SchedulingPayload => payloadOf(buildSchedulingPayload(form));

test("scheduling send accepts 2xx, refreshes once on 401, and blocks on 403", async () => {
  resetSchedulingSendBlocksForTests();
  const payload = sample();
  let posts = 0;
  const sent = await sendSchedulingNotification(payload, {
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return jsonResponse(200, { success: true });
    },
  });
  assert.equal(posts, 1);
  assert.equal(sent.status, "sent");

  posts = 0;
  const emptyBody = await sendSchedulingNotification(payload, {
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(posts, 1);
  assert.equal(emptyBody.status, "sent");

  posts = 0;
  const forces: boolean[] = [];
  const refreshed = await sendSchedulingNotification(payload, {
    getToken: async (force) => {
      forces.push(force);
      return force ? "fresh" : "stale";
    },
    post: async (_path, init) => {
      posts += 1;
      const authorization = (init.headers as Record<string, string>).Authorization;
      if (posts === 1) {
        assert.equal(authorization, "Bearer stale");
        return jsonResponse(401, { error: "Sign in again." });
      }
      assert.equal(authorization, "Bearer fresh");
      return jsonResponse(200, { success: true });
    },
  });
  assert.deepEqual(forces, [false, true]);
  assert.equal(posts, 2);
  assert.equal(refreshed.status, "sent");

  posts = 0;
  const second401 = await sendSchedulingNotification(payload, {
    getToken: async (force) => (force ? "fresh" : "stale"),
    post: async () => {
      posts += 1;
      return jsonResponse(401, { error: "Sign in again." });
    },
  });
  assert.equal(posts, 2);
  assert.deepEqual(second401, { status: "signin", message: SIGN_IN_AGAIN_MESSAGE });

  posts = 0;
  const noToken = await sendSchedulingNotification(payload, {
    getToken: async () => {
      throw new Error("offline");
    },
    post: async () => {
      posts += 1;
      return jsonResponse(200, { success: true });
    },
  });
  assert.equal(posts, 0);
  assert.equal(noToken.status, "signin");

  posts = 0;
  const emptyToken = await sendSchedulingNotification(payload, {
    getToken: async () => "",
    post: async () => {
      posts += 1;
      return jsonResponse(200, {});
    },
  });
  assert.equal(posts, 0);
  assert.equal(emptyToken.status, "signin");

  posts = 0;
  const refreshFailed = await sendSchedulingNotification(payload, {
    getToken: async (force) => {
      if (force) throw new Error("expired");
      return "stale";
    },
    post: async () => {
      posts += 1;
      return jsonResponse(401, { error: "Sign in again." });
    },
  });
  assert.equal(posts, 1);
  assert.equal(refreshFailed.status, "signin");

  posts = 0;
  const blocked = await sendSchedulingNotification(payload, {
    accountId: "demo",
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return jsonResponse(403, { error: "Test accounts cannot send notifications." });
    },
  });
  assert.equal(posts, 1);
  assert.equal(blocked.status, "blocked");
  if (blocked.status === "blocked") assert.equal(blocked.message, "Test accounts cannot send notifications.");
  assert.equal(schedulingBlockedFor("demo"), true);

  const unsafe = await sendSchedulingNotification(payload, {
    accountId: "other",
    getToken: async () => "token",
    post: async () => jsonResponse(403, { error: "see the webhook setup" }),
  });
  assert.equal(unsafe.status, "blocked");
  if (unsafe.status === "blocked") assert.equal(unsafe.message, SCHEDULING_BLOCKED_MESSAGE);
  resetSchedulingSendBlocksForTests();
});

test("scheduling send rate-limits from Retry-After and never auto-retries ambiguous results", async () => {
  resetSchedulingSendBlocksForTests();
  const payload = sample();
  let posts = 0;
  const limited = await sendSchedulingNotification(payload, {
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return jsonResponse(429, { error: "Too many notifications. Try again in a minute." }, { "Retry-After": "7" });
    },
  });
  assert.equal(posts, 1);
  assert.deepEqual(limited, {
    status: "rateLimited",
    retryAfterSec: 7,
    message: "Too many requests. You can send again in 7 seconds.",
  });

  for (const header of [undefined, "0", "61", "7.5", "soon"]) {
    posts = 0;
    const outcome = await sendSchedulingNotification(payload, {
      getToken: async () => "token",
      post: async () => {
        posts += 1;
        return jsonResponse(429, { error: "Too many notifications. Try again in a minute." }, header ? { "Retry-After": header } : undefined);
      },
    });
    assert.equal(posts, 1);
    assert.equal(outcome.status, "rateLimited");
    if (outcome.status === "rateLimited") assert.equal(outcome.retryAfterSec, 60);
  }

  for (const status of [500, 502, 405]) {
    posts = 0;
    const outcome = await sendSchedulingNotification(payload, {
      getToken: async () => "token",
      post: async () => {
        posts += 1;
        return status === 405
          ? new Response(null, { status })
          : jsonResponse(status, { error: status === 500 ? "Internal error" : "Discord did not accept the notification." });
      },
    });
    assert.equal(posts, 1);
    assert.deepEqual(outcome, { status: "ambiguous", message: AMBIGUOUS_SEND_MESSAGE });
    assert.equal(schedulingBlockedFor("demo"), false);
  }

  posts = 0;
  const notConfigured = await sendSchedulingNotification(payload, {
    accountId: "demo",
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return jsonResponse(503, { error: "Discord notifications are not configured." });
    },
  });
  assert.equal(posts, 1);
  assert.deepEqual(notConfigured, { status: "notConfigured", message: NOT_CONFIGURED_MESSAGE });
  assert.equal(schedulingBlockedFor("demo"), false);
  assert.equal(JSON.stringify(notConfigured).includes(AMBIGUOUS_SEND_MESSAGE), false);

  posts = 0;
  const unavailable = await sendSchedulingNotification(payload, {
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return new Response("<html>missing</html>", { status: 404, headers: { "Content-Type": "text/html" } });
    },
  });
  assert.equal(posts, 1);
  assert.deepEqual(unavailable, { status: "unavailable", message: SCHEDULING_ROUTE_UNAVAILABLE_MESSAGE });

  posts = 0;
  const invalid = await sendSchedulingNotification(payload, {
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return jsonResponse(400, { error: "Name is required." });
    },
  });
  assert.equal(posts, 1);
  assert.equal(invalid.status, "invalid");
  if (invalid.status === "invalid") assert.equal(invalid.message, "Name is required.");

  posts = 0;
  const threw = await sendSchedulingNotification(payload, {
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      throw new Error("network down");
    },
  });
  assert.equal(posts, 1);
  assert.deepEqual(threw, { status: "ambiguous", message: AMBIGUOUS_SEND_MESSAGE });

  posts = 0;
  const retryThrew = await sendSchedulingNotification(payload, {
    getToken: async (force) => (force ? "fresh" : "stale"),
    post: async () => {
      posts += 1;
      if (posts === 1) return jsonResponse(401, { error: "Sign in again." });
      throw new Error("network down");
    },
  });
  assert.equal(posts, 2);
  assert.deepEqual(retryThrew, { status: "ambiguous", message: AMBIGUOUS_SEND_MESSAGE });

  posts = 0;
  const timedOut = await sendSchedulingNotification(payload, {
    getToken: async () => "token",
    timeoutMs: 20,
    post: () => {
      posts += 1;
      return new Promise(() => {});
    },
  });
  assert.equal(posts, 1);
  assert.deepEqual(timedOut, { status: "ambiguous", message: AMBIGUOUS_SEND_MESSAGE });
  resetSchedulingSendBlocksForTests();
});

test("safeServerError hides long errors and anything that mentions a URL or webhook", () => {
  assert.equal(safeServerError(400, { error: "Notification is too long." }), "Notification is too long.");
  assert.equal(safeServerError(400, { error: "x".repeat(201) }), "Failed to send notification (400).");
  assert.equal(safeServerError(403, { error: "posted to https://example.test/hook" }), "Failed to send notification (403).");
  assert.equal(safeServerError(502, { error: "Discord webhook rejected it" }), "Failed to send notification (502).");
  assert.equal(safeServerError(500, "<html>nope</html>"), "Failed to send notification (500).");
  assert.equal(safeServerError(400, { error: 12 }), "Failed to send notification (400).");
});

test("client sources do not carry a scheduling webhook and a denied phone read does not disable Send", () => {
  assert.equal(existsSync(path.join(root, "app/utils/schedulingWebhook.ts")), false);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "server" || entry === "node_modules") continue;
      const full = path.join(dir, entry);
      if (path.resolve(full) === path.resolve(root, "app/api")) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?|mjs)$/.test(entry)) files.push(full);
    }
  };
  walk(path.join(root, "app"));
  assert.ok(files.length > 10);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("discord.com"), false, file);
    assert.equal(source.includes("discordapp.com"), false, file);
    assert.equal(source.includes("notificationWebhook"), false, file);
  }
  const modal = readFileSync(path.join(root, "app/components/LeadEditorModal.tsx"), "utf8");
  assert.match(modal, /sendSchedulingNotification/);
  assert.match(modal, /blockedForAccount/);
  assert.doesNotMatch(modal, /setSchedulingUnavailable|schedulingUnavailable/);
  const phoneLoad = modal.slice(modal.indexOf("loadSchedulingManagerPhone"), modal.indexOf("loadUser();"));
  assert.match(phoneLoad, /getAdminSettingsAsync/);
  assert.doesNotMatch(phoneLoad, /blockedForAccount|setAccountBlocked/);
  const settings = readFileSync(path.join(root, "app/admin/settings/page.tsx"), "utf8");
  assert.match(settings, /Scheduling notifications are managed on the server\./);
  assert.doesNotMatch(settings, /getAdminSettingsAsync|saveAdminSettingsAsync/);
});
