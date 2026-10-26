import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { changedContactPatch } from "../../app/components/contactPatch";
import { acceptDisposition } from "../../app/field/draftQueue";
import { migrateDraft, reopenDeniedParked, resetParkedReopenForTests } from "../../app/field/draftMigration";
import { schedulingHold } from "../../app/field/draftState";
import { directPatch, mergeReportingPatch } from "../../app/field/directWrites";
import {
  ACCURACY_CAP_M,
  ACCURACY_MAX_M,
  GPS_RADIUS_M,
  GPS_UNVERIFIED_POLICY,
  REDUCED_ACCURACY_METERS,
  SYNC_REPORT_EXTENDED_GPS_KEYS,
  classifyKnock,
  knockVerified,
  precisionFromSignals,
} from "../../app/field/gpsPolicy";
import { displayedKnockPoint } from "../../app/field/knockPoint";
import { droppedPinGps, evaluateKnockFix, resolveDraftGps, stageKnockGps } from "../../app/field/pendingGps";
import { bestFixInWindow, noteAndroidPermissions, noteWarmFix, resetWarmGpsForTests } from "../../app/field/warmGps";
import { SYNC_REPORT_MAX_AGE_MS, extendedGpsKeyRejected, readSyncLog, recordSyncEvent, reportParked, resetSyncLogForTests, syncReportItem } from "../../app/field/syncDiagnostics";
import { SEND_BUILD_HEADERS, apiFetch, nativeApiFetch } from "../../app/utils/apiFetch";
import {
  DRAFT_ID_PATTERN,
  FIELD_DISPO_PATH,
  SERVER_DISPO_SLOW_RETRY_MS,
  deliverFieldDispo,
  fieldDispoBody,
  postFieldDispo,
  prefersServerDispo,
  rebaseNotes,
  releaseFieldDispoHolds,
} from "../../app/field/serverDispo";
import { SYNC_REASON } from "../../app/field/syncReasons";
import { syncOutbox } from "../../app/field/syncOutbox";
import type { PendingMutation } from "../../app/field/types";
import { deletionBlockedReason } from "../../app/mobile/_lib/accountPolicy";
import type { Lead, User } from "../../app/types";
import { AMBIGUOUS_SEND_MESSAGE, sendSchedulingNotification } from "../../app/utils/schedulingNotification";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const user = { id: "rep", name: "Rep" } as User;
const at = "2026-10-25T15:00:00.000Z";

function knock(patch: Partial<PendingMutation> = {}): PendingMutation {
  return {
    id: "draft-1",
    userId: "rep",
    userName: "Rep",
    leadId: "lead-1",
    createdAt: at,
    kind: "knock",
    baseStatus: "claimed",
    baseNotes: "",
    status: "not-home",
    disposition: "Not Home",
    syncState: "queued",
    attempts: 0,
    direct: { patch: { status: "not-home" }, serverDispo: true },
    ...patch,
  };
}

function json(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("a dispo saves beside a parked draft and both stay", () => {
  const parked = knock({ id: "old", syncState: "parked", parkedReason: SYNC_REASON.permissionDenied });
  const next = acceptDisposition([parked], knock({ id: "new" }));
  assert.equal(next.id, "new");
  assert.equal(next.syncState, "queued");
  assert.equal(parked.syncState, "parked");
});

test("a failed-precondition stays queued instead of sending twice", async () => {
  let rows = [knock()];
  let sends = 0;
  await syncOutbox({
    read: async () => rows,
    send: async () => {
      sends += 1;
      if (sends === 1) throw Object.assign(Error("stale"), { code: "failed-precondition" });
    },
    remove: async () => {
      throw Error("must not remove");
    },
    update: async (row) => {
      rows = [row];
    },
    report: async () => {},
    active: () => true,
  });
  assert.equal(sends, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].syncState, "retry");
  assert.equal(rows[0].parkedReason, undefined);
});

test("newest action time wins and history keeps both entries", () => {
  const older = {
    status: "not-home",
    dispositionedAt: new Date("2026-10-25T15:00:00.000Z"),
    dispositionHistory: [{ disposition: "Not Home", timestamp: new Date("2026-10-25T15:00:00.000Z"), userId: "rep", userName: "Rep" }],
  };
  const newer = {
    status: "interested",
    dispositionedAt: new Date("2026-10-25T15:05:00.000Z"),
    dispositionHistory: [{ disposition: "Interested", timestamp: new Date("2026-10-25T15:05:00.000Z"), userId: "rep", userName: "Rep" }],
  };
  const forward = mergeReportingPatch(older, newer);
  assert.equal(forward.patch.status, "interested");
  assert.equal(forward.patch.dispositionHistory?.[0].disposition, "Interested");
  assert.equal(forward.patch.dispositionHistory?.length, 2);
  const reverse = mergeReportingPatch(newer, older);
  assert.equal(reverse.patch.status, undefined);
  assert.equal(reverse.patch.dispositionHistory?.[0].disposition, "Interested");
  assert.equal(reverse.patch.dispositionHistory?.length, 2);
  const replay = mergeReportingPatch({ ...newer, dispositionHistory: forward.patch.dispositionHistory }, newer);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.patch, {});
});

test("a newer server disposition keeps status and coordinates and gains history", () => {
  const current = {
    status: "sale",
    lat: 1,
    lng: 2,
    dispositionedAt: new Date("2026-10-25T16:00:00.000Z"),
    dispositionHistory: [{ disposition: "Sale", timestamp: new Date("2026-10-25T16:00:00.000Z"), userId: "rep", userName: "Rep" }],
  };
  const patch = {
    status: "not-home",
    lat: 9,
    lng: 9,
    knockGpsLat: 3,
    dispositionedAt: new Date(at),
    dispositionHistory: [{ disposition: "Not Home", timestamp: new Date(at), userId: "rep", userName: "Rep" }],
  };
  const merged = mergeReportingPatch(current, patch);
  assert.deepEqual(Object.keys(merged.patch), ["dispositionHistory"]);
  assert.equal(merged.patch.dispositionHistory?.some((entry) => entry.disposition === "Not Home"), true);
  assert.equal("lat" in merged.patch, false);
});

test("permission-denied uses /api/field/dispo and a later 403 parks the body reason once", async () => {
  resetSyncLogForTests();
  const paths: string[] = [];
  await deliverFieldDispo(knock({ direct: { patch: { status: "not-home" } } }), user, {
    commit: async () => {
      throw Object.assign(Error("permission-denied"), { code: "permission-denied", status: 403 });
    },
    getToken: async () => "token",
    post: async (routePath) => {
      paths.push(routePath);
      return json(200, { lead: { id: "lead-1" } });
    },
  });
  assert.deepEqual(paths, [FIELD_DISPO_PATH]);

  let rows = [knock()];
  let sends = 0;
  const posted: { reasonCode?: string }[] = [];
  await syncOutbox({
    read: async () => rows,
    send: async () => {
      sends += 1;
      throw Object.assign(Error("denied"), { status: 403, reasonCode: SYNC_REASON.historicalPin });
    },
    remove: async () => {
      throw Error("must not remove");
    },
    update: async (row) => {
      rows = [row];
    },
    report: async (userId) => {
      await reportParked(userId, {
        probe: async () => 200,
        post: async (items) => {
          posted.push(...items);
          return 200;
        },
      });
    },
    active: () => true,
  });
  assert.equal(rows[0].syncState, "parked");
  assert.equal(rows[0].parkedReason, "historical_pin");
  assert.equal(rows[0].error, undefined);
  assert.equal(posted[0]?.reasonCode, "historical_pin");
  for (let i = 0; i < 3; i += 1) {
    await syncOutbox({
      read: async () => rows,
      send: async () => {
        sends += 1;
        throw Error("again");
      },
      remove: async () => {},
      update: async () => {},
      report: async () => {},
      active: () => true,
    });
  }
  assert.equal(sends, 1);
});

test("a 404 keeps the draft queued and schedules a slow retry", async () => {
  const now = 1_700_000_000_000;
  let rows = [
    knock(),
    knock({ id: "draft-2", createdAt: "2026-10-25T15:01:00.000Z" }),
    knock({ id: "draft-3", leadId: "lead-2", createdAt: "2026-10-25T15:02:00.000Z" }),
  ];
  const calls: string[] = [];
  const run = (clock: number) =>
    syncOutbox({
      now: () => clock,
      random: () => 0,
      read: async () => rows,
      send: async (row) => {
        calls.push(row.id);
        if (row.leadId === "lead-1")
          throw Object.assign(Error("not deployed"), { status: 404, code: "field-dispo-unavailable" });
      },
      remove: async (id) => {
        rows = rows.filter((row) => row.id !== id);
      },
      update: async (row) => {
        rows = rows.map((item) => (item.id === row.id ? row : item));
      },
      report: async () => {},
      active: () => true,
    });
  await run(now);
  const held = rows.find((row) => row.id === "draft-1");
  assert.equal(held?.syncState, "queued");
  assert.equal(held?.routeHold, "field-dispo");
  assert.equal(held?.parkedReason, undefined);
  assert.equal(held?.nextAttemptAt, now + SERVER_DISPO_SLOW_RETRY_MS);
  assert.equal(rows.some((row) => row.id === "draft-2"), true);
  assert.equal(rows.some((row) => row.id === "draft-3"), false);
  calls.length = 0;
  await run(now + 60_000);
  assert.deepEqual(calls, []);
  assert.equal(rows.length, 2);
  rows = releaseFieldDispoHolds(rows);
  assert.equal(rows.find((row) => row.id === "draft-1")?.nextAttemptAt, undefined);
  await run(now + 60_000);
  assert.equal(calls[0], "draft-1");
});

test("200 removes the draft, including an older tap the server already merged", async () => {
  const bodies: { draftId?: string; actionAt?: unknown }[] = [];
  let rows = [knock()];
  await syncOutbox({
    read: async () => rows,
    send: async (row) => {
      const saved = await postFieldDispo(row, user, {
        getToken: async () => "token",
        post: async (_path, init) => {
          bodies.push(JSON.parse(String(init.body)));
          return json(200, { historyAppended: true, statusUnchanged: true });
        },
      });
      assert.equal(saved.replayed, false);
    },
    remove: async (id) => {
      rows = rows.filter((row) => row.id !== id);
    },
    update: async () => {},
    report: async () => {},
    active: () => true,
  });
  assert.equal(rows.length, 0);
  assert.equal(bodies[0].draftId, "draft-1");
  assert.equal(bodies[0].actionAt, at);
  assert.equal(typeof bodies[0].actionAt, "string");
});

test("409 rebases notes onto currentNotes and retries instead of parking", async () => {
  assert.deepEqual(rebaseNotes("", "Call after 5", "Dog in yard"), {
    notes: "Dog in yard\nCall after 5",
    baseNotes: "Dog in yard",
  });
  const unmerged = rebaseNotes("base the rep never saw", "Call after 5", "Dog in yard");
  assert.equal(unmerged.notes, "Dog in yard\nCall after 5");
  assert.equal(unmerged.baseNotes, "Dog in yard");
  const once = rebaseNotes("", "Call after 5", "Dog in yard").notes;
  assert.equal(rebaseNotes("", "Call after 5", once).notes, once);
  assert.equal(rebaseNotes("Dog in yard", once, "Dog in yard").notes, once);
  assert.equal(rebaseNotes("base the rep never saw", "Call after 5", unmerged.notes).notes, unmerged.notes);

  const notes = knock({
    id: "note-1",
    kind: "notes",
    notes: "edited",
    baseNotes: "original",
    direct: { patch: { notes: "edited" }, serverDispo: true },
  });
  const bodies: Array<{ draftId: string; photos?: unknown; notes?: string; baseNotes?: string }> = [];
  let posts = 0;
  await postFieldDispo(notes, user, {
    getToken: async () => "token",
    post: async (_path, init) => {
      posts += 1;
      const body = JSON.parse(String(init.body)) as { draftId: string; photos?: unknown; notes?: string; baseNotes?: string };
      bodies.push(body);
      assert.equal(body.photos, undefined);
      if (posts === 1) return json(409, { currentNotes: "someone else" });
      return json(200, {});
    },
  });
  assert.deepEqual(bodies.map((body) => body.draftId), ["note-1", "note-1"]);
  assert.equal(bodies[1].baseNotes, "someone else");
  assert.equal(bodies[1].notes, "someone else\nedited");

  const appended = knock({
    id: "note-2",
    kind: "notes",
    notes: "original\nmy note",
    baseNotes: "original",
    direct: { patch: { notes: "original\nmy note" }, serverDispo: true },
  });
  posts = 0;
  const merged: string[] = [];
  await postFieldDispo(appended, user, {
    getToken: async () => "token",
    post: async (_path, init) => {
      posts += 1;
      const body = JSON.parse(String(init.body)) as { notes?: string };
      merged.push(body.notes || "");
      if (posts === 1) return json(409, { currentNotes: "original\nother" });
      return json(200, {});
    },
  });
  assert.equal(merged[1], "original\nother\nmy note");

  posts = 0;
  let rows = [notes];
  await syncOutbox({
    now: () => Date.parse(at),
    random: () => 0,
    read: async () => rows,
    send: async (row) => postFieldDispo(row, user, {
      getToken: async () => "token",
      post: async () => {
        posts += 1;
        return json(409, { currentNotes: "someone else" });
      },
    }),
    remove: async () => {
      throw Error("must not remove");
    },
    update: async (row) => {
      rows = [row];
    },
    report: async () => {},
    active: () => true,
  });
  assert.equal(posts, 2);
  assert.equal(rows[0].syncState, "retry");
  assert.equal(rows[0].parkedReason, undefined);
  assert.equal(rows[0].notes, "edited");
  assert.equal(rows[0].blocked, undefined);
});

test("410 and 400 park, 413 stays queued as payload_too_large, and a 403 without a known reason uses other", async () => {
  const cases: Array<[number, string, string]> = [
    [410, "parked", "not_found"],
    [400, "parked", "invalid_payload"],
    [413, "queued", "payload_too_large"],
    [403, "parked", "other"],
  ];
  for (const [status, state, reason] of cases) {
    let rows = [knock({ id: `draft-${status}` })];
    await syncOutbox({
      read: async () => rows,
      send: async (row) => postFieldDispo(row, user, {
        getToken: async () => "token",
        post: async () => json(status, status === 403 ? { reasonCode: "not-a-code" } : {}),
      }),
      remove: async () => {
        throw Error("must not remove");
      },
      update: async (row) => {
        rows = [row];
      },
      report: async () => {},
      active: () => true,
    });
    assert.equal(rows[0].syncState, state);
    assert.equal(rows[0].parkedReason, reason);
    if (status === 413) {
      assert.equal(rows[0].routeHold, "field-dispo");
      assert.ok((rows[0].nextAttemptAt || 0) > 0);
    }
  }
});

test("401 refreshes the token once and then backs off", async () => {
  const forces: boolean[] = [];
  let posts = 0;
  await assert.rejects(
    () => postFieldDispo(knock(), user, {
      getToken: async (force) => {
        forces.push(!!force);
        return "token";
      },
      post: async () => {
        posts += 1;
        return json(401, {});
      },
    }),
    (error: Error & { status?: number }) => error.status === 401,
  );
  assert.deepEqual(forces, [false, true]);
  assert.equal(posts, 2);

  const now = 1_700_000_000_000;
  let rows = [knock()];
  await syncOutbox({
    now: () => now,
    random: () => 0,
    read: async () => rows,
    send: async () => {
      throw Object.assign(Error("Sign in again to sync your work."), { status: 401 });
    },
    remove: async () => {
      throw Error("must not remove");
    },
    update: async (row) => {
      rows = [row];
    },
    report: async () => {},
    active: () => true,
  });
  assert.equal(rows[0].syncState, "retry");
  assert.equal(rows[0].parkedReason, undefined);
  assert.ok((rows[0].nextAttemptAt || 0) > now);
});

test("429 waits for Retry-After instead of the fast backoff", async () => {
  const now = 1_700_000_000_000;
  let rows = [knock()];
  await syncOutbox({
    now: () => now,
    random: () => 0,
    read: async () => rows,
    send: async (row) => postFieldDispo(row, user, {
      getToken: async () => "token",
      post: async () => json(429, {}, { "retry-after": "120" }),
    }),
    remove: async () => {
      throw Error("must not remove");
    },
    update: async (row) => {
      rows = [row];
    },
    report: async () => {},
    active: () => true,
  });
  assert.equal(rows[0].syncState, "retry");
  assert.equal(rows[0].nextAttemptAt, now + 120_000);
});

test("photos and handoffs are never posted", async () => {
  const body = fieldDispoBody(knock({
    direct: {
      patch: {
        status: "not-home",
        photos: [{ id: "p", url: "https://example.invalid/secret.jpg", caption: "", type: "other", uploadedBy: "rep", uploadedAt: new Date(at) }],
        notes: "secret note",
        knockGpsLat: 43,
        knockGpsLng: -77,
        knockGpsAccuracy: 8,
        knockGpsTimestamp: new Date("2026-10-25T15:00:05.000Z"),
        gpsVerified: false,
        gpsUnverifiedReason: "too_far",
        userId: "rep",
      } as Partial<Lead>,
      serverDispo: true,
    },
  }), user);
  const encoded = JSON.stringify(body);
  assert.equal(encoded.includes("secret"), false);
  assert.equal(encoded.includes("photos"), false);
  assert.equal(encoded.includes("knockGps"), false);
  assert.equal(encoded.includes("gpsVerified"), false);
  assert.equal(encoded.includes("userId"), false);
  assert.equal(encoded.includes("dispositionHistory"), false);
  assert.equal(body.kind, "knock");
  assert.equal(typeof body.actionAt, "string");
  assert.equal(body.gps?.capturedAt, "2026-10-25T15:00:05.000Z");
  assert.equal(body.gps?.accuracyM, 8);
  let posted = false;
  await deliverFieldDispo(knock({
    id: "hand-1",
    kind: "handoff",
    handoff: "acknowledged",
    direct: { patch: {}, serverDispo: true },
  }), user, {
    commit: async () => ({ replayed: false }),
    getToken: async () => "token",
    post: async () => {
      posted = true;
      return json(200, {});
    },
  });
  assert.equal(posted, false);
  assert.equal(DRAFT_ID_PATTERN.test("draft-1"), true);
  assert.equal(DRAFT_ID_PATTERN.test("bad id"), false);
});

test("a transient failure does not stop the next lead", async () => {
  const now = 1_700_000_000_000;
  let rows = [knock({ id: "a", leadId: "a" }), knock({ id: "b", leadId: "b", createdAt: "2026-10-25T15:05:00.000Z" })];
  const sent: string[] = [];
  await syncOutbox({
    now: () => now,
    random: () => 0,
    read: async () => rows,
    send: async (row) => {
      if (row.id === "a") throw Object.assign(Error("offline"), { status: 503 });
      sent.push(row.id);
    },
    remove: async (id) => {
      rows = rows.filter((row) => row.id !== id);
    },
    update: async (row) => {
      rows = rows.map((item) => (item.id === row.id ? row : item));
    },
    report: async () => {},
    active: () => true,
  });
  assert.deepEqual(sent, ["b"]);
  assert.equal(rows[0].syncState, "retry");
  assert.ok((rows[0].nextAttemptAt || 0) > now);
});

test("rep-facing sync copy and the Sync tab are gone", () => {
  const banned = /saved changes need attention|Sync needs review|This pin has a sync conflict|Save failed:|Disposition failed to save|awaiting sync|Discard draft/;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx|ts|css)$/.test(name)) files.push(full);
    }
  };
  walk(path.join(root, "app"));
  for (const file of files) assert.doesNotMatch(readFileSync(file, "utf8"), banned, file);
  assert.equal(existsSync(path.join(root, "app/mobile/_components/UnsyncedNotice.tsx")), false);
  assert.doesNotMatch(readFileSync(path.join(root, "app/field/FieldWorkspace.tsx"), "utf8"), /Sync \(/);
  assert.match(readFileSync(path.join(root, "app/field/serverDispo.ts"), "utf8"), /Notes changed on another device\. Review this draft\./);
});

test("scheduling is posted once on an ambiguous timeout and is not an outbox route", async () => {
  let calls = 0;
  const outcome = await sendSchedulingNotification({
    kind: "scheduling",
    name: "Ada",
    address: "1 Main",
    city: "Rochester",
    state: "NY",
    zip: "14601",
    phone: "555",
  }, {
    getToken: async () => "token",
    timeoutMs: 20,
    post: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 80));
      return json(502, {});
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(outcome, { status: "ambiguous", message: AMBIGUOUS_SEND_MESSAGE });
  assert.equal(FIELD_DISPO_PATH.includes("discord"), false);
  assert.doesNotMatch(readFileSync(path.join(root, "app/field/syncOutbox.ts"), "utf8"), /scheduling/i);
});

test("legacy gps blocks are re-queued as flagged dispos and other blocks replay once", () => {
  const createdAt = "2026-10-11T12:00:00.000Z";
  const gps = migrateDraft(knock({
    createdAt,
    syncState: undefined,
    blocked: true,
    error: "Location could not verify this knock within 164 feet of the home.",
    direct: { patch: { status: "not-home" }, gps: { lat: 1, lng: 2, deadline: 0, required: true } },
  }));
  assert.equal(gps.syncState, "queued");
  assert.equal(gps.createdAt, createdAt);
  assert.equal(gps.parkedReason, undefined);
  assert.equal(gps.direct?.gps, undefined);
  assert.equal(gps.direct?.patch.gpsVerified, false);
  assert.equal(gps.direct?.patch.gpsUnverifiedReason, "too_far");
  assert.equal(migrateDraft(gps), gps);
  const plain = migrateDraft(knock({ syncState: undefined, blocked: true, error: "offline", direct: { patch: { status: "not-home" } } }));
  assert.equal(plain.syncState, "queued");
  assert.equal(plain.blocked, undefined);
  assert.equal(migrateDraft(plain), plain);
  const legacyReason = migrateDraft(knock({ syncState: "parked", parkedReason: "denied" as PendingMutation["parkedReason"] }));
  assert.equal(legacyReason.parkedReason, "permission_denied");
  resetParkedReopenForTests();
  const reopened = reopenDeniedParked([
    gps,
    knock({ id: "gone", syncState: "parked", parkedReason: SYNC_REASON.notFound }),
    knock({ id: "notes", syncState: "parked", parkedReason: SYNC_REASON.notesConflict }),
  ], "rep");
  assert.equal(reopened[0].syncState, "queued");
  assert.equal(reopened[0].createdAt, createdAt);
  assert.equal(reopened[1].syncState, "queued");
  assert.equal(reopened[2].syncState, "queued");
  assert.equal(reopened[2].parkedReason, SYNC_REASON.notesConflict);
});

test("default GPS policy flags instead of holding, with the shared 35/15/65 rule", () => {
  assert.equal(GPS_UNVERIFIED_POLICY, "flag");
  assert.equal(GPS_RADIUS_M, 35);
  assert.equal(ACCURACY_CAP_M, 15);
  assert.equal(ACCURACY_MAX_M, 65);
  assert.equal(REDUCED_ACCURACY_METERS, 1000);
  assert.equal(knockVerified(50, 15), true);
  assert.equal(knockVerified(51, 15), false);
  assert.equal(classifyKnock({ hasFix: true, inWindow: true, hadStaleFix: false, accuracyM: 66, distanceM: 0, precision: "precise" }).gpsVerified, false);
  const low = classifyKnock({ hasFix: true, inWindow: true, hadStaleFix: false, accuracyM: 66, distanceM: 0, precision: "precise" });
  assert.equal(low.gpsVerified, false);
  if (!low.gpsVerified) assert.equal(low.reason, "low_accuracy");
  const missing = classifyKnock({ hasFix: true, inWindow: true, hadStaleFix: true, accuracyM: Number.NaN, distanceM: Number.NaN, precision: "precise", malformed: true });
  assert.equal(missing.gpsVerified, false);
  if (!missing.gpsVerified) assert.equal(missing.reason, "no_fix");
  const negative = classifyKnock({ hasFix: true, inWindow: true, hadStaleFix: false, accuracyM: -1, distanceM: 0, precision: "precise" });
  assert.equal(negative.gpsVerified, false);
  if (!negative.gpsVerified) assert.equal(negative.reason, "no_fix");
  const order = classifyKnock({ hasFix: true, inWindow: true, hadStaleFix: false, accuracyM: 10, distanceM: 80, precision: "precise", outsideArea: true });
  assert.equal(order.gpsVerified, false);
  if (!order.gpsVerified) assert.equal(order.reason, "out_of_area");
  const accuracyFirst = classifyKnock({ hasFix: true, inWindow: true, hadStaleFix: false, accuracyM: 1000, distanceM: 80, precision: "reduced", outsideArea: true });
  assert.equal(accuracyFirst.gpsVerified, false);
  if (!accuracyFirst.gpsVerified) assert.equal(accuracyFirst.reason, "reduced_accuracy");
  const draft = knock({
    createdAt: new Date().toISOString(),
    direct: { patch: { status: "not-home" }, gps: { lat: 43, lng: -77, required: true, deadline: Date.now() + 15_000, tappedAt: Date.now() } },
  });
  const far = evaluateKnockFix(draft, { timestamp: Date.now(), coords: { latitude: 43.01, longitude: -77, accuracy: 5 } });
  assert.equal(far.gpsVerified, false);
  assert.equal(far.reason, "too_far");
  assert.equal(typeof far.distanceM, "number");
  assert.equal(far.patch.gpsVerified, false);
  assert.equal(far.patch.knockDistanceFromAddress, far.distanceM);
});

test("ensureLeadSynced ignores parked drafts and still waits on a queued one", () => {
  assert.equal(schedulingHold([knock({ syncState: "parked", parkedReason: SYNC_REASON.notFound })], "lead-1"), null);
  assert.match(schedulingHold([knock({ syncState: "queued" })], "lead-1") || "", /Wait a moment and try again/);
});

test("storage is not cleared while any draft exists", () => {
  assert.equal(deletionBlockedReason({ drafts: 0, recordings: 0 }), null);
  assert.match(deletionBlockedReason({ drafts: 1, recordings: 0 }) || "", /will not sign you out/);
  assert.match(readFileSync(path.join(root, "app/mobile/_components/AccountDeletion.tsx"), "utf8"), /Review unsynced visits/);
});

test("the route is for historical pins and unowned pins a rep cannot read; admins still write directly", () => {
  assert.equal(prefersServerDispo({ historicalTerritoryPin: true, territoryId: "t" }, "rep"), true);
  assert.equal(prefersServerDispo({ historicalTerritoryPin: true }, "admin", "admin"), true);
  assert.equal(prefersServerDispo({ territoryId: undefined }, "rep"), true);
  assert.equal(prefersServerDispo({ territoryId: undefined }, "admin", "admin"), false);
  assert.equal(prefersServerDispo({ claimedBy: "rep" }, "rep"), false);
  assert.equal(prefersServerDispo({ territoryId: "t" }, "rep"), false);
  assert.equal(prefersServerDispo({ claimedBy: "other" }, "admin", "admin"), false);
});

test("reason codes are the shared dispo and sync-report list", async () => {
  assert.deepEqual(Object.values(SYNC_REASON).sort(), [
    "gps_unverified_flagged",
    "gps_unverified_held",
    "historical_pin",
    "invalid_payload",
    "not_found",
    "notes_conflict",
    "other",
    "out_of_territory",
    "outside_50m",
    "owned_by_other",
    "payload_too_large",
    "permission_denied",
    "stale_tap",
  ]);
  resetSyncLogForTests();
  await recordSyncEvent({
    id: "event-1",
    userId: "rep",
    at: 1,
    draftId: "draft-1",
    leadId: "lead-1",
    createdAt: at,
    disposition: "Not Home",
    state: "parked",
    parkedReason: SYNC_REASON.outside50m,
    lastError: "too far",
    attempts: 1,
  });
  const sent: { reasonCode?: string }[] = [];
  await reportParked("rep", {
    probe: async () => 204,
    post: async (items) => {
      sent.push(...items);
      return 200;
    },
  });
  assert.equal(sent[0]?.reasonCode, "outside_50m");
});

test("native contact save sends only the fields that changed", () => {
  const lead = {
    id: "lead-1",
    name: "Ada",
    address: "1 Main",
    city: "Rochester",
    state: "NY",
    zip: "14601",
    phone: "555",
    email: "",
    notes: "old",
    estimatedBill: 120,
    status: "claimed",
    createdAt: new Date(at),
  } as Lead;
  const same = {
    name: "Ada",
    address: "1 Main",
    city: "Rochester",
    state: "NY",
    zip: "14601",
    phone: "555",
    email: "",
    notes: "old",
    estimatedBill: 120,
  };
  assert.equal(changedContactPatch(lead, same), null);
  assert.deepEqual(changedContactPatch(lead, { ...same, phone: "556" }), { phone: "556" });
  assert.deepEqual(changedContactPatch(lead, { ...same, notes: "new", estimatedBill: "140" }), {
    notes: "new",
    estimatedBill: 140,
  });
});

test("the map and the gate measure the same displayed point and never rewrite the stored lead", () => {
  const lead = { id: "lead-1", lat: 43, lng: -77 };
  const home = { id: "home-9", lat: 43.001, lng: -77.001 };
  const point = displayedKnockPoint(lead, home);
  assert.equal(point?.source, "homeowner_corrected");
  assert.equal(point?.homeownerId, "home-9");
  const shown = point?.source === "homeowner_corrected" ? { ...lead, lat: point.lat, lng: point.lng } : lead;
  assert.equal(shown.lat, point?.lat);
  assert.equal(shown.lng, point?.lng);
  assert.equal(lead.lat, 43);
  assert.equal(displayedKnockPoint(lead, { id: "home-9", lat: 43, lng: -77 })?.source, "lead_stored");
  assert.equal(displayedKnockPoint(lead, { id: "home-9", lat: 43, lng: -77 })?.homeownerId, undefined);
  assert.match(readFileSync(path.join(root, "app/components/LeadMap.tsx"), "utf8"), /displayedKnockPoint/);
});

test("the fix window starts at the tap and keeps the best sample from that window", () => {
  resetWarmGpsForTests();
  const tap = Date.now() - 40_000;
  noteWarmFix({ timestamp: tap - 31_000, coords: { latitude: 43, longitude: -77, accuracy: 1 } });
  noteWarmFix({ timestamp: tap - 30_000, coords: { latitude: 43, longitude: -77, accuracy: 3 } });
  noteWarmFix({ timestamp: tap + 1_000, coords: { latitude: 43, longitude: -77, accuracy: 20 } });
  noteWarmFix({ timestamp: tap + 2_000, coords: { latitude: 43, longitude: -77, accuracy: 8 } });
  const best = bestFixInWindow(tap, Date.now());
  assert.equal(best?.coords.accuracy, 3);
  assert.equal(best?.timestamp, tap - 30_000);
  const draft = knock({
    createdAt: new Date(tap).toISOString(),
    direct: {
      patch: { status: "not-home" },
      gps: { lat: 43, lng: -77, required: true, tappedAt: tap, deadline: tap + 15_000, source: "lead_stored" },
    },
  });
  const staged = stageKnockGps(draft, Date.now());
  assert.equal(staged.syncState, "queued");
  assert.equal(staged.direct?.patch.gpsVerified, true);
  assert.equal(new Date(staged.direct?.patch.knockGpsTimestamp as Date).getTime(), tap - 30_000);
  assert.equal(typeof staged.direct?.patch.knockDistanceFromAddress, "number");
});

test("backgrounded capture flags no_fix and a flagged knock does not block the next dispo", async () => {
  resetWarmGpsForTests();
  const tap = Date.now();
  const pending = knock({
    id: "gps-draft",
    createdAt: new Date(tap).toISOString(),
    direct: { patch: { status: "not-home" }, gps: { lat: 43, lng: -77, required: true, tappedAt: tap, deadline: tap + 15_000 } },
  });
  let saved: PendingMutation | undefined;
  let located = false;
  await resolveDraftGps(pending, {
    read: async () => [pending],
    put: async (draft) => { saved = draft; },
    active: () => true,
    backgrounded: () => true,
    sleep: async () => {},
    locate: async () => { located = true; throw new Error("must not locate"); },
  });
  assert.equal(located, false);
  assert.equal(saved?.syncState, "queued");
  assert.equal(saved?.parkedReason, undefined);
  assert.equal(saved?.direct?.patch.gpsVerified, false);
  assert.equal(saved?.direct?.patch.gpsUnverifiedReason, "no_fix");
  let rows = [
    saved!,
    knock({ id: "next", createdAt: new Date(tap + 1).toISOString(), direct: { patch: { status: "interested" } } }),
  ];
  const sent: string[] = [];
  await syncOutbox({
    read: async () => rows,
    send: async (draft) => { sent.push(draft.id); },
    remove: async (id) => { rows = rows.filter((draft) => draft.id !== id); },
    block: async () => {},
    active: () => true,
    report: async () => { throw new Error("sync-report is down"); },
  });
  assert.deepEqual(sent.sort(), ["gps-draft", "next"]);
  assert.equal(rows.length, 0);
});

test("reduced accuracy is flagged for an iOS 1000m fix and an Android coarse permission", () => {
  assert.equal(precisionFromSignals({ platform: "ios", accuracy: REDUCED_ACCURACY_METERS }), "reduced");
  assert.equal(precisionFromSignals({ platform: "ios", accuracy: 12 }), "precise");
  resetWarmGpsForTests();
  assert.equal(noteAndroidPermissions({ coarseLocation: "granted", location: "denied" }), "reduced");
  assert.equal(noteAndroidPermissions({ coarseLocation: "granted", location: "granted" }) === "reduced", false);
  const draft = knock({
    direct: { patch: { status: "not-home" }, gps: { lat: 43, lng: -77, required: true, tappedAt: Date.now(), deadline: Date.now() + 15_000 } },
  });
  const reduced = evaluateKnockFix(draft, { timestamp: Date.now(), coords: { latitude: 43, longitude: -77, accuracy: 1000 } }, { precision: "reduced" });
  assert.equal(reduced.reason, "reduced_accuracy");
  assert.equal(reduced.patch.gpsVerified, false);
  assert.equal(reduced.patch.knockDistanceFromAddress !== undefined, true);
});

test("a dropped pin stores the fix timestamp and distance and the dispo UI has no GPS failure copy", () => {
  const fields = droppedPinGps(
    { timestamp: 1_700_000_000_000, coords: { latitude: 43, longitude: -77, accuracy: 5 } },
    43,
    -77,
  );
  assert.equal(new Date(fields.knockGpsTimestamp as Date).getTime(), 1_700_000_000_000);
  assert.equal(typeof fields.knockDistanceFromAddress, "number");
  assert.equal(fields.gpsVerified, true);
  const banned = /Within 100 feet|164 feet|could not verify this knock|Enable precise location|GPS capture window expired|unsynced knock|Flagged GPS send/;
  for (const file of ["app/components/LeadDetail.tsx", "app/components/LeadMap.tsx", "app/components/AddLeadModal.tsx", "app/field/pendingGps.ts", "app/field/areaGate.ts", "app/homeowners/knockGps.ts"]) {
    assert.doesNotMatch(readFileSync(path.join(root, file), "utf8"), banned, file);
  }
  assert.match(readFileSync(path.join(root, "app/field/areaGate.ts"), "utf8"), /You are not in your assigned area\./);
  for (const file of ["app/components/LeadDetail.tsx", "app/components/LeadMap.tsx", "app/components/AddLeadModal.tsx"]) {
    assert.match(readFileSync(path.join(root, file), "utf8"), /AREA_BLOCK_MESSAGE/, file);
  }
});

test("direct patch whitelists gps flags and the route body carries homeownerId only for a corrected point", () => {
  const written = directPatch({
    status: "not-home",
    gpsVerified: false,
    gpsUnverifiedReason: "too_far",
    gpsDistanceM: 80,
    homeownerId: "home-9",
    gpsPointSource: "homeowner_corrected",
  } as Partial<Lead>);
  assert.equal(written.gpsVerified, false);
  assert.equal(written.gpsUnverifiedReason, "too_far");
  assert.equal(written.gpsDistanceM, 80);
  const areaReason = directPatch({ status: "not-home", gpsVerified: false, gpsUnverifiedReason: "out_of_area", gpsDistanceM: 40 });
  assert.equal(areaReason.gpsUnverifiedReason, "too_far");
  assert.equal(areaReason.gpsVerified, false);
  assert.equal((written as { homeownerId?: string }).homeownerId, undefined);
  assert.equal((written as { gpsPointSource?: string }).gpsPointSource, undefined);
  const corrected = fieldDispoBody(knock({
    direct: {
      patch: { status: "not-home", gpsVerified: false, gpsUnverifiedReason: "too_far", gpsDistanceM: 80 },
      serverDispo: true,
      homeownerId: "home-9",
      gpsPointSource: "homeowner_corrected",
    },
  }), user);
  assert.equal(corrected.homeownerId, "home-9");
  assert.equal(corrected.kind, "knock");
  assert.equal("gpsVerified" in corrected, false);
  assert.equal(corrected.gps, undefined);
  const stored = fieldDispoBody(knock({
    direct: {
      patch: { status: "not-home" },
      serverDispo: true,
      homeownerId: "home-9",
      gpsPointSource: "lead_stored",
    },
  }), user);
  assert.equal(stored.homeownerId, undefined);
});

test("permission-denied with gps flags falls back to the route, and a 404 retries without those keys", async () => {
  const flagged = knock({
    direct: { patch: { status: "not-home", gpsVerified: false, gpsUnverifiedReason: "no_fix" } },
  });
  let commits = 0;
  const saved = await deliverFieldDispo(flagged, user, {
    getToken: async () => "token",
    commit: async (draft) => {
      commits += 1;
      if (commits === 1) throw Object.assign(new Error("denied"), { code: "permission-denied" });
      assert.equal(draft.direct?.patch.gpsVerified, undefined);
      assert.equal(draft.direct?.patch.gpsUnverifiedReason, undefined);
      return { replayed: false };
    },
    post: async () => json(404, {}),
  });
  assert.equal(saved.replayed, false);
  assert.equal(commits, 2);
  const posted = await deliverFieldDispo(flagged, user, {
    getToken: async () => "token",
    commit: async () => { throw Object.assign(new Error("denied"), { code: "permission-denied" }); },
    post: async (_path, init) => {
      const body = JSON.parse(String(init.body));
      assert.equal(body.kind, "knock");
      assert.equal(body.gpsVerified, undefined);
      assert.equal(body.gpsUnverifiedReason, undefined);
      assert.equal(body.userId, undefined);
      return json(200, { ok: true, reasonCode: "not_a_known_code" });
    },
  });
  assert.equal(posted.replayed, false);
});

test("sync-report sends extended gps keys, strips them once on a named 400, and never sends point source", async () => {
  assert.equal(SYNC_REPORT_EXTENDED_GPS_KEYS, true);
  resetSyncLogForTests();
  await recordSyncEvent({
    id: "flag-1",
    userId: "rep",
    at: 2,
    draftId: "draft-1",
    leadId: "lead-1",
    createdAt: at,
    status: "not-home",
    state: "flagged",
    gpsUnverifiedReason: "too_far",
    locationPrecision: "precise",
    distanceM: 90,
    gpsAccuracyM: 12,
    gpsPointSource: "homeowner_corrected",
    attempts: 0,
  });
  const bodies: ReturnType<typeof syncReportItem>[][] = [];
  const first = await reportParked("rep", {
    probe: async () => 204,
    post: async (items) => {
      bodies.push(items);
      if (bodies.length === 1) return { status: 400, body: { error: "Invalid report", field: "gpsUnverifiedReason", index: 0 } };
      return 200;
    },
  });
  assert.equal(first.sent, 1);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0][0].reasonCode, "gps_unverified_flagged");
  assert.equal(bodies[0][0].outcome, "flagged_accepted");
  assert.equal(bodies[0][0].gpsUnverifiedReason, "too_far");
  assert.equal(bodies[0][0].locationPrecision, "precise");
  assert.equal(bodies[0][0].distanceM, 90);
  assert.equal((bodies[0][0] as { gpsPointSource?: string }).gpsPointSource, undefined);
  assert.equal((bodies[0][0] as { homeownerId?: string }).homeownerId, undefined);
  assert.equal(bodies[1][0].gpsUnverifiedReason, undefined);
  assert.equal(bodies[1][0].locationPrecision, undefined);
  assert.equal(bodies[1][0].reasonCode, "gps_unverified_flagged");
  await recordSyncEvent({
    id: "flag-2",
    userId: "rep",
    at: 3,
    draftId: "draft-2",
    leadId: "lead-1",
    createdAt: at,
    status: "not-home",
    state: "flagged",
    gpsUnverifiedReason: "no_fix",
    locationPrecision: "reduced",
    attempts: 0,
  });
  const reports = await reportParked("rep", {
    probe: async () => 204,
    post: async (items) => {
      assert.equal(items[0]?.gpsUnverifiedReason, undefined);
      return { status: 400, body: { error: "Invalid report", field: "reports" } };
    },
  });
  assert.equal(reports.sent, 0);
  assert.equal(reports.status, 400);
  assert.equal(extendedGpsKeyRejected({ status: 400, body: { error: "Invalid report", field: "reports" } }), false);
  assert.equal(extendedGpsKeyRejected({ status: 400, raw: "{\"field\":\"locationPrecision\"}" }), true);
  assert.equal(extendedGpsKeyRejected({ status: 400, body: { error: "gpsUnverifiedReason" } }), false);
});

test("native requests carry the build headers and web fetch calls carry neither", async () => {
  assert.equal(SEND_BUILD_HEADERS, true);
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://example.com";
  await nativeApiFetch("/api/field/dispo", {
    method: "POST",
    headers: { Authorization: "Bearer test-only", "Content-Type": "application/json" },
    body: "{}",
  }, async (request) => {
    assert.equal(request.headers?.["X-Raydar-Build"], "158");
    assert.equal(request.headers?.["X-Raydar-Platform"], "ios");
    return { status: 200, data: "{}", headers: {}, url: request.url };
  }, "ios");
  await nativeApiFetch("/api/field/dispo", { method: "GET" }, async (request) => {
    assert.equal(request.headers?.["X-Raydar-Build"], "158");
    assert.equal(request.headers?.["X-Raydar-Platform"], "android");
    return { status: 200, data: "{}", headers: {}, url: request.url };
  }, "android");
  await nativeApiFetch("/api/field/dispo", { method: "GET" }, async (request) => {
    assert.equal(request.headers?.["X-Raydar-Build"], undefined);
    assert.equal(request.headers?.["x-raydar-build"], undefined);
    assert.equal(request.headers?.["X-Raydar-Platform"], undefined);
    return { status: 200, data: "{}", headers: {}, url: request.url };
  }, "web");
  const init = { method: "POST", headers: { Authorization: "Bearer test-only" }, body: "{}" };
  const response = new Response("{}", { status: 200 });
  const original = globalThis.fetch;
  globalThis.fetch = async (_path, options) => {
    const headers = new Headers((options as RequestInit | undefined)?.headers);
    assert.equal(headers.get("X-Raydar-Build"), null);
    assert.equal(headers.get("X-Raydar-Platform"), null);
    return response;
  };
  try {
    assert.equal(await apiFetch("/api/field/dispo", init), response);
  } finally {
    globalThis.fetch = original;
  }
});

test("a direct deny tries the route, then the plain 14.17 patch saves on any non-2xx", async () => {
  let posts = 0;
  let commits = 0;
  const saved = await deliverFieldDispo(knock({
    direct: {
      patch: { status: "not-home", gpsVerified: false, gpsUnverifiedReason: "too_far", gpsDistanceM: 80 },
    },
  }), user, {
    getToken: async () => "token",
    commit: async (draft) => {
      commits += 1;
      if (commits === 1) {
        assert.equal(draft.direct?.patch.gpsVerified, false);
        throw Object.assign(Error("denied"), { code: "permission-denied" });
      }
      assert.equal(draft.direct?.patch.gpsVerified, undefined);
      assert.equal(draft.direct?.patch.gpsUnverifiedReason, undefined);
      assert.equal(draft.direct?.patch.status, "not-home");
      return { replayed: false };
    },
    post: async () => {
      posts += 1;
      return json(404, {});
    },
  });
  assert.equal(saved.replayed, false);
  assert.equal(commits, 2);
  assert.equal(posts, 1);
});

test("sync-report keeps the newest draftId, drops a rejected index once, and does not retry a bad batch", async () => {
  resetSyncLogForTests();
  const now = Date.parse(at);
  await recordSyncEvent({
    id: "old-row", userId: "rep", at: 1, draftId: "draft-1", leadId: "lead-1", createdAt: at,
    state: "parked", parkedReason: SYNC_REASON.other, attempts: 0,
  });
  await recordSyncEvent({
    id: "new-row", userId: "rep", at: 2, draftId: "draft-1", leadId: "lead-1", createdAt: at,
    status: "interested", state: "parked", parkedReason: SYNC_REASON.other, attempts: 1,
  });
  await recordSyncEvent({
    id: "other-row", userId: "rep", at: 3, draftId: "draft-2", leadId: "lead-2", createdAt: at,
    status: "not-home", state: "flagged", gpsUnverifiedReason: "no_fix", attempts: 0,
  });
  const posted: string[][] = [];
  const first = await reportParked("rep", {
    now: () => now,
    probe: async () => 204,
    post: async (items) => {
      posted.push(items.map((item) => item.draftId));
      if (posted.length === 1) return { status: 400, body: { error: "Invalid report", field: "draftId", index: 0 } };
      return 200;
    },
  });
  assert.equal(first.sent, 1);
  assert.deepEqual(posted, [["draft-1", "draft-2"], ["draft-2"]]);
  assert.equal((await readSyncLog("rep")).some((event) => event.id === "old-row" && event.reported), true);

  resetSyncLogForTests();
  await recordSyncEvent({
    id: "batch", userId: "rep", at: 4, draftId: "draft-9", leadId: "lead-1", createdAt: at,
    state: "parked", parkedReason: SYNC_REASON.other, attempts: 0,
  });
  let calls = 0;
  const rejected = await reportParked("rep", {
    now: () => now,
    probe: async () => 204,
    post: async () => {
      calls += 1;
      return { status: 400, body: { error: "Invalid report", field: "reports" } };
    },
  });
  assert.equal(calls, 1);
  assert.equal(rejected.sent, 0);
  assert.equal(rejected.status, 400);
  const again = await reportParked("rep", {
    now: () => now,
    probe: async () => 204,
    post: async () => {
      calls += 1;
      return 200;
    },
  });
  assert.equal(again.sent, 0);
  assert.equal(calls, 1);

  resetSyncLogForTests();
  const expiredAt = new Date(now - SYNC_REPORT_MAX_AGE_MS - 60_000).toISOString();
  await recordSyncEvent({
    id: "expired", userId: "rep", at: 5, draftId: "draft-old", leadId: "lead-1", createdAt: expiredAt,
    state: "parked", parkedReason: SYNC_REASON.other, attempts: 0,
  });
  let expiredPosts = 0;
  const expired = await reportParked("rep", {
    now: () => now,
    probe: async () => 204,
    post: async () => {
      expiredPosts += 1;
      return 200;
    },
  });
  assert.equal(expired.sent, 0);
  assert.equal(expiredPosts, 0);
  assert.equal((await readSyncLog("rep")).some((event) => event.id === "expired" && event.reported), true);
});
