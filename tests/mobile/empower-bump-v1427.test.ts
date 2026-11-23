import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EmpowerBumpForm from "../../app/components/EmpowerBumpForm";
import LeadDetail from "../../app/components/LeadDetail";
import { EMPOWER_INCOME_LIMITS_CSV } from "../../app/empower/incomeLimitsCsv";
import {
  ASSISTANCE_HELPER,
  ASSISTANCE_PROGRAMS,
  CATEGORICAL_TIER1_NOTE,
  EMPOWER_BUMP_ID,
  EMPOWER_MAX_HOUSEHOLD,
  ESTIMATE_NOTE,
  HOUSEHOLD_LIMIT_HELPER,
  NY_COUNTIES,
  SSI_HELPER,
  bandChoices,
  bandForIncome,
  buildEmpowerBumpPayload,
  canOfferEmpowerBump,
  empowerContactPatch,
  comfortLabel,
  incomeTable,
  knownCounty,
  limitsFor,
  programsForceTier1,
  tier1Label,
  tier3Label,
  type EmpowerBumpPayload,
} from "../../app/empower/bumpLogic";
import {
  EMPOWER_AMBIGUOUS_MESSAGE,
  EMPOWER_API_ORIGIN,
  EMPOWER_BUMP_PATH,
  EMPOWER_QUEUED_MESSAGE,
  EMPOWER_MIN_RETRY_MS,
  EMPOWER_OFFLINE_MESSAGE,
  EMPOWER_PENDING_LABEL,
  EMPOWER_RATE_MESSAGE,
  deliverEmpowerBump,
  empowerBumpPending,
  empowerNotice,
  finishEmpowerBump,
  flushQueuedEmpowerBumps,
  memoryEmpowerStorage,
  resetEmpowerFlushForTests,
  schedulingFollowsBump,
  storedEmpowerState,
  subscribeEmpowerAuthFlush,
  type EmpowerOutcome,
} from "../../app/empower/empowerBump";
import type { Lead, User, UserRole } from "../../app/types";
import {
  DEFAULT_DISPOSITIONS,
  EMPOWER_BUMP_DISPOSITION_ID,
  KNOCK_STATUS_IDS,
  SCHEDULED_GO_BACK_STATUS_IDS,
  findMissingDefaultDispositions,
  isKnockStatus,
  isScheduledGoBackStatus,
  mergeMissingDefaultDispositions,
} from "../../app/types/disposition";
import { isCountedKnock } from "../../app/utils/knockCount";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const KNOCK_COUNT_SHA = "a00be3335708b5b54605b08f11bd37fb9fa5ada20e3c0cb428d57b58bf1dd226";

function read(rel: string) {
  return readFileSync(path.join(root, rel), "utf8");
}

function jsonResponse(status: number, body?: unknown, headers?: Record<string, string>): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
  });
}

function person(role: UserRole, id = role): User {
  return {
    id,
    name: role,
    email: `${role}@example.test`,
    color: "#476E88",
    role,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function door(patch: Partial<Lead> = {}): Lead {
  return {
    id: "door-1",
    name: "Ada Lovelace",
    address: "10 Main St",
    city: "Buffalo",
    state: "NY",
    zip: "14201",
    phone: "555-0100",
    email: "ada@example.test",
    status: "not-home",
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    ...patch,
  } as Lead;
}

function baseInput(patch: Record<string, unknown> = {}) {
  return {
    draftId: "draft-1",
    actedAt: "2026-11-23T19:00:00.000Z",
    leadId: "door-1",
    name: "Ada Lovelace",
    phone: "555-555-0100",
    email: "",
    address: "10 Main St",
    city: "Buffalo",
    state: "ny",
    zip: "14201",
    county: "Erie",
    householdSize: 1,
    estimatedBand: "tier1" as const,
    assistancePrograms: [] as string[],
    assistanceNone: true,
    confirmedContact: true,
    ...patch,
  };
}

function payloadOf(built: ReturnType<typeof buildEmpowerBumpPayload>): EmpowerBumpPayload {
  assert.equal(built.ok, true);
  if (!built.ok) throw new Error("expected a payload");
  return built.payload;
}

test("Empower Bump is a default counted knock and not a go-back", () => {
  const bump = DEFAULT_DISPOSITIONS.find((row) => row.id === EMPOWER_BUMP_DISPOSITION_ID);
  const goBack = DEFAULT_DISPOSITIONS.find((row) => row.id === "go-back");
  const house = DEFAULT_DISPOSITIONS.find((row) => row.id === "house-for-sale");
  const notHome = DEFAULT_DISPOSITIONS.find((row) => row.id === "not-home");
  assert.ok(bump);
  assert.equal(bump?.name, "Empower Bump");
  assert.equal(bump?.countsAsDoorKnock, true);
  assert.equal(bump?.isDefault, true);
  assert.equal(bump?.specialBehavior, "empower-bump");
  assert.equal(bump?.icon, "zap");
  assert.equal(bump?.order, 9);
  assert.equal(bump?.color.toLowerCase(), "#14b8a6");
  assert.notEqual(bump?.color.toLowerCase(), goBack?.color.toLowerCase());
  assert.notEqual(bump?.color.toLowerCase(), house?.color.toLowerCase());
  assert.notEqual(bump?.color.toLowerCase(), notHome?.color.toLowerCase());
  assert.equal(EMPOWER_BUMP_ID, "empower-bump");
  assert.equal(isKnockStatus("empower-bump"), true);
  assert.equal((KNOCK_STATUS_IDS as readonly string[]).includes("empower-bump"), true);
  assert.equal(isScheduledGoBackStatus("empower-bump"), false);
  assert.equal((SCHEDULED_GO_BACK_STATUS_IDS as readonly string[]).includes("empower-bump"), false);
  assert.equal(isCountedKnock("empower-bump"), true);
  const hash = createHash("sha256").update(read("app/utils/knockCount.ts")).digest("hex");
  assert.equal(hash, KNOCK_COUNT_SHA);
  const existing = DEFAULT_DISPOSITIONS.filter((row) => row.id !== "empower-bump");
  assert.equal(findMissingDefaultDispositions(existing).some((row) => row.id === "empower-bump"), true);
  const merged = mergeMissingDefaultDispositions(existing);
  assert.equal(merged.filter((row) => row.id === "empower-bump").length, 1);
  assert.equal(mergeMissingDefaultDispositions(merged).length, merged.length);
});

test("income table matches the March 18, 2026 expansion and stops at household 10", () => {
  const csv = read("app/data/empower-income-limits-2026-03-18.csv");
  assert.equal(csv, EMPOWER_INCOME_LIMITS_CSV);
  const table = incomeTable();
  assert.equal(table.counties.length, 62);
  assert.equal(NY_COUNTIES.length, 62);
  assert.equal(NY_COUNTIES.includes("St. Lawrence"), true);
  assert.equal(NY_COUNTIES.includes("New York"), true);
  assert.equal(table.limits.size, 620);
  assert.deepEqual(limitsFor("Erie", 1), { tier1: 42450, tier3: 56600 });
  assert.deepEqual(limitsFor("Monroe", 1), { tier1: 43650, tier3: 58200 });
  assert.deepEqual(limitsFor("Onondaga", 1), { tier1: 43500, tier3: 58000 });
  const floorCounties = NY_COUNTIES.filter((county) => {
    const limits = limitsFor(county, 4);
    return limits?.tier1 === 80160 && limits.tier3 === 106880;
  });
  assert.equal(floorCounties.length, 52);
  assert.equal(floorCounties.includes("St. Lawrence"), true);
  assert.equal(floorCounties.includes("Erie"), true);
  assert.equal(limitsFor("Erie", 11), null);
  assert.equal(limitsFor("Erie", 0), null);
  assert.equal(EMPOWER_MAX_HOUSEHOLD, 10);
  const erie = limitsFor("Erie", 1)!;
  assert.equal(bandForIncome(42450, erie), "tier1");
  assert.equal(bandForIncome(42451, erie), "tier3");
  assert.equal(bandForIncome(56600, erie), "tier3");
  assert.equal(bandForIncome(56601, erie), "comfort_home");
  const monroe = limitsFor("Monroe", 1)!;
  assert.equal(bandForIncome(43650, monroe), "tier1");
  assert.equal(bandForIncome(58200, monroe), "tier3");
  assert.equal(bandForIncome(58201, monroe), "comfort_home");
  const onondaga = limitsFor("Onondaga", 1)!;
  assert.equal(bandForIncome(43500, onondaga), "tier1");
  assert.equal(bandForIncome(58000, onondaga), "tier3");
  assert.equal(tier1Label(erie), "Tier 1 (est.) — at or under $42,450. Estimated, final tier set from income documents");
  assert.equal(tier3Label(erie), "Tier 3 (est.) — above $42,450 and at or under $56,600. Estimated, final tier set from income documents");
  assert.equal(comfortLabel(erie), "Comfort Home (est.) — above $56,600. Estimated, final tier set from income documents");
  assert.equal(ESTIMATE_NOTE, "Estimated, final tier set from income documents");
  assert.deepEqual(bandChoices("Erie", 1).map((choice) => choice.id), ["tier1", "tier3", "comfort_home", "not_sure"]);
  assert.deepEqual(bandChoices("", 1).map((choice) => choice.id), ["not_sure"]);
  assert.equal(programsForceTier1(["SSI (Supplemental Security Income)"]), true);
  assert.equal(programsForceTier1([]), false);
});

test("the bump payload omits empty optionals and never sends a dollar amount", () => {
  const built = payloadOf(buildEmpowerBumpPayload(baseInput()));
  assert.equal(built.actedAt, "2026-11-23T19:00:00.000Z");
  assert.equal(built.state, "NY");
  assert.equal(built.estimatedBand, "tier1");
  assert.equal(built.assistanceNone, true);
  assert.equal("email" in built, false);
  assert.equal("town" in built, false);
  assert.equal("repName" in built, false);
  assert.equal("assistancePrograms" in built, false);
  assert.equal("annualHouseholdIncome" in built, false);
  assert.equal(JSON.stringify(built).includes("annualHouseholdIncome"), false);

  const withEmail = payloadOf(buildEmpowerBumpPayload(baseInput({
    email: " ada@example.test ",
    town: "Buffalo",
    zip: "142016789",
    assistanceNone: false,
    assistancePrograms: [ASSISTANCE_PROGRAMS[2], ASSISTANCE_PROGRAMS[0]],
    estimatedBand: "comfort_home",
  })));
  assert.equal(withEmail.email, "ada@example.test");
  assert.equal(withEmail.town, "Buffalo");
  assert.equal(withEmail.zip, "14201-6789");
  assert.equal(withEmail.estimatedBand, "tier1");
  assert.equal(withEmail.assistanceNone, false);
  assert.deepEqual(withEmail.assistancePrograms, [ASSISTANCE_PROGRAMS[0], ASSISTANCE_PROGRAMS[2]]);

  const notSure = payloadOf(buildEmpowerBumpPayload(baseInput({ county: "", estimatedBand: "not_sure" })));
  assert.equal(notSure.estimatedBand, "not_sure");
  assert.equal("county" in notSure, false);

  const needsCounty = buildEmpowerBumpPayload(baseInput({ county: "", estimatedBand: "tier3" }));
  assert.equal(needsCounty.ok, false);
  const combined = buildEmpowerBumpPayload(baseInput({
    assistanceNone: true,
    assistancePrograms: [ASSISTANCE_PROGRAMS[0]],
  }));
  assert.equal(combined.ok, false);
  assert.equal(knownCounty({ address: "10 Main St, Erie County" }), "Erie");
  assert.equal(knownCounty({ city: "Erie" }), "");
  assert.equal(knownCounty({ county: "st. lawrence" }), "St. Lawrence");
});

test("setters, closers, managers, and admins see Empower Bump, and a redacted pin does not", () => {
  for (const role of ["setter", "closer", "manager", "admin"] as const) {
    assert.equal(canOfferEmpowerBump({ role, contactRedacted: false }), true, role);
    const markup = renderToStaticMarkup(createElement(LeadDetail, {
      lead: door(),
      currentUser: person(role),
      onClose: () => {},
      onUpdate: () => {},
      fieldMemory: true,
      dispositionOptions: DEFAULT_DISPOSITIONS,
    }));
    assert.equal(markup.includes("Empower Bump"), true, role);
    assert.match(markup, /aria-label="NH — Not Home"/);
  }
  assert.equal(canOfferEmpowerBump({ role: "closer", contactRedacted: true }), false);
  assert.equal(canOfferEmpowerBump({ role: "sales", contactRedacted: false }), false);
  const redacted = renderToStaticMarkup(createElement(LeadDetail, {
    lead: door({ contactRedacted: true, name: "Hidden Name", phone: "555-0199", email: "door@example.test" }),
    currentUser: person("closer"),
    onClose: () => {},
    onUpdate: () => {},
    fieldMemory: true,
    dispositionOptions: DEFAULT_DISPOSITIONS,
  }));
  assert.equal(redacted.includes("Empower Bump"), false);
  assert.match(redacted, /aria-label="NH — Not Home"/);
  assert.equal(redacted.includes("555-0199"), false);
  assert.equal(redacted.includes("door@example.test"), false);
});

test("the form shows the published helpers and does not offer household 11", () => {
  const markup = renderToStaticMarkup(createElement(EmpowerBumpForm, {
    lead: door({ address: "10 Main St, Erie County" }),
    onClose: () => {},
    onSubmit: async (): Promise<EmpowerOutcome> => ({ status: "sent", attempted: true }),
  }));
  assert.equal(markup.includes(HOUSEHOLD_LIMIT_HELPER), true);
  assert.equal(markup.includes(ASSISTANCE_HELPER), true);
  assert.equal(markup.includes(SSI_HELPER), true);
  assert.equal(markup.includes("Social Security Retirement or Disability"), true);
  for (const label of ASSISTANCE_PROGRAMS) assert.equal(markup.includes(label), true, label);
  assert.equal(markup.includes(">None<"), true);
  assert.equal(markup.includes('value="11"'), false);
  assert.equal(markup.includes("St. Lawrence"), true);
  assert.equal(markup.includes("New York"), true);
  assert.equal(markup.includes(ESTIMATE_NOTE), true);
  assert.equal(markup.includes("Name, phone, and email are correct."), true);
  assert.match(markup, /aria-labelledby="empower-assistance-legend"/);
  assert.match(markup, /id="empower-assistance-none"/);
  assert.equal(markup.includes(CATEGORICAL_TIER1_NOTE), false);
  assert.match(markup, /<span>SSI \(Supplemental Security Income\)<\/span><\/label><p[^>]*>SSI is not Social Security Retirement or Disability\.<\/p>/);
});

test("office send is idempotent, queues 404 and 503, and does not retry an ambiguous call", async () => {
  assert.equal(EMPOWER_BUMP_PATH, "/api/empower-bump");
  assert.equal(EMPOWER_API_ORIGIN, "https://happy-solar-leads.vercel.app");
  const payload = payloadOf(buildEmpowerBumpPayload(baseInput({ draftId: "draft-send" })));
  const storage = memoryEmpowerStorage();
  let posts = 0;
  const sent = await deliverEmpowerBump(payload, {
    uid: "rep-1",
    storage,
    getToken: async () => "token",
    post: async (path, init) => {
      posts += 1;
      assert.equal(path, "/api/empower-bump");
      const headers = init.headers as Record<string, string>;
      assert.equal(headers.Authorization, "Bearer token");
      assert.equal(JSON.parse(String(init.body)).draftId, "draft-send");
      return jsonResponse(200, { ok: true });
    },
  });
  assert.equal(posts, 1);
  assert.equal(sent.status, "sent");
  assert.equal(schedulingFollowsBump(sent), true);
  assert.equal(storedEmpowerState("draft-send", storage, "rep-1"), "sent");
  posts = 0;
  const again = await deliverEmpowerBump(payload, {
    uid: "rep-1",
    storage,
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return jsonResponse(200);
    },
  });
  assert.equal(posts, 0);
  assert.equal(again.status, "sent");
  assert.equal(schedulingFollowsBump(again), false);

  for (const status of [404, 503] as const) {
    const id = `draft-${status}`;
    const queuedStorage = memoryEmpowerStorage();
    posts = 0;
    const queued = await deliverEmpowerBump({ ...payload, draftId: id }, {
      uid: "rep-1",
      storage: queuedStorage,
      getToken: async () => "token",
      post: async () => {
        posts += 1;
        return jsonResponse(status, { error: "not enabled" });
      },
    });
    assert.equal(posts, 1);
    assert.equal(queued.status, "queued");
    assert.equal(queued.status === "queued" && queued.message, EMPOWER_QUEUED_MESSAGE);
    assert.equal(JSON.stringify(queued).includes(EMPOWER_AMBIGUOUS_MESSAGE), false);
    assert.equal(schedulingFollowsBump(queued), true);
    assert.equal(storedEmpowerState(id, queuedStorage, "rep-1"), "queued");
  }

  const forces: boolean[] = [];
  posts = 0;
  const refreshed = await deliverEmpowerBump({ ...payload, draftId: "draft-401" }, {
    uid: "rep-1",
    storage: memoryEmpowerStorage(),
    getToken: async (force) => {
      forces.push(force);
      return force ? "fresh" : "stale";
    },
    post: async (_path, init) => {
      posts += 1;
      const authorization = (init.headers as Record<string, string>).Authorization;
      if (posts === 1) {
        assert.equal(authorization, "Bearer stale");
        return jsonResponse(401);
      }
      assert.equal(authorization, "Bearer fresh");
      return jsonResponse(204);
    },
  });
  assert.deepEqual(forces, [false, true]);
  assert.equal(posts, 2);
  assert.equal(refreshed.status, "sent");

  for (const status of [500, 502]) {
    const ambiguousStorage = memoryEmpowerStorage();
    posts = 0;
    const outcome = await deliverEmpowerBump({ ...payload, draftId: `draft-${status}` }, {
      uid: "rep-1",
      storage: ambiguousStorage,
      getToken: async () => "token",
      post: async () => {
        posts += 1;
        return jsonResponse(status);
      },
    });
    assert.equal(posts, 1);
    assert.equal(outcome.status, "ambiguous");
    assert.equal(storedEmpowerState(`draft-${status}`, ambiguousStorage, "rep-1"), "ambiguous");
    const retry = await deliverEmpowerBump({ ...payload, draftId: `draft-${status}` }, {
      uid: "rep-1",
      storage: ambiguousStorage,
      getToken: async () => "token",
      post: async () => {
        posts += 1;
        return jsonResponse(200);
      },
    });
    assert.equal(posts, 1);
    assert.equal(retry.status, "ambiguous");
    assert.equal(schedulingFollowsBump(retry), false);
  }

  posts = 0;
  const timedOut = await deliverEmpowerBump({ ...payload, draftId: "draft-timeout" }, {
    uid: "rep-1",
    storage: memoryEmpowerStorage(),
    timeoutMs: 20,
    getToken: async () => "token",
    post: () => {
      posts += 1;
      return new Promise(() => {});
    },
  });
  assert.equal(posts, 1);
  assert.equal(timedOut.status, "ambiguous");

  posts = 0;
  const dropped = await deliverEmpowerBump({ ...payload, draftId: "draft-network" }, {
    uid: "rep-1",
    storage: memoryEmpowerStorage(),
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      throw new Error("network down");
    },
  });
  assert.equal(posts, 1);
  assert.deepEqual(dropped, { status: "ambiguous", message: EMPOWER_AMBIGUOUS_MESSAGE, attempted: true });

  posts = 0;
  const signedOut = await deliverEmpowerBump({ ...payload, draftId: "draft-signed-out" }, {
    uid: "rep-1",
    storage: memoryEmpowerStorage(),
    getToken: async () => {
      throw new Error("signed-out");
    },
    post: async () => {
      posts += 1;
      return jsonResponse(200);
    },
  });
  assert.equal(posts, 0);
  assert.equal(signedOut.status, "signin");
  assert.equal(schedulingFollowsBump(signedOut), false);
});

test("a finished bump opens the existing scheduling flow, including queued and ambiguous results", async () => {
  const order: string[] = [];
  const queued = await finishEmpowerBump({
    saveLocal: async () => {
      order.push("save");
    },
    send: async () => {
      order.push("send");
      return { status: "queued", message: EMPOWER_QUEUED_MESSAGE, attempted: true };
    },
    openScheduling: () => {
      order.push("scheduling");
    },
  });
  assert.deepEqual(order, ["save", "send", "scheduling"]);
  assert.equal(queued.status, "queued");

  let sends = 0;
  let opened = 0;
  const ambiguous = await finishEmpowerBump({
    saveLocal: async () => {},
    send: async () => {
      sends += 1;
      return { status: "ambiguous", message: EMPOWER_AMBIGUOUS_MESSAGE, attempted: true };
    },
    openScheduling: () => {
      opened += 1;
      throw new Error("scheduling failed");
    },
  });
  assert.equal(sends, 1);
  assert.equal(opened, 1);
  assert.equal(ambiguous.status, "ambiguous");

  let saved = 0;
  await assert.rejects(() => finishEmpowerBump({
    saveLocal: async () => {
      saved += 1;
      throw new Error("not close enough");
    },
    send: async () => {
      sends += 1;
      return { status: "sent", attempted: true };
    },
    openScheduling: () => {
      opened += 1;
    },
  }));
  assert.equal(saved, 1);
  assert.equal(sends, 1);
  assert.equal(opened, 1);

  const detail = read("app/components/LeadDetail.tsx");
  const submit = detail.slice(detail.indexOf("const handleEmpowerSubmit"), detail.indexOf("// Handle saving notes"));
  assert.match(submit, /finishEmpowerBump/);
  assert.match(submit, /deliverEmpowerBump/);
  assert.match(submit, /openCallSchedulingManager/);
  assert.ok(submit.indexOf("saveLocal") < submit.indexOf("send:") && submit.indexOf("send:") < submit.indexOf("openScheduling"));
  assert.doesNotMatch(submit, /homeownerKnockGps|getLocation|sendSchedulingNotification/);
  assert.match(detail, /onClick=\{openCallSchedulingManager\}/);
  assert.match(detail, /aria-label="CSM — Call Scheduling Manager"/);
  assert.equal(detail.includes("sendSchedulingNotification"), false);
  const client = read("app/empower/empowerBump.ts");
  assert.match(client, /apiFetch/);
  assert.equal(client.includes("discord.com"), false);
  assert.equal(client.includes("discordapp.com"), false);
  assert.equal(client.includes("notificationWebhook"), false);
  assert.match(client, /!\/webhook\/i\.test/);
  assert.equal(client.includes("console."), false);
});

test("queued bumps flush once for the signed-in rep, and ambiguous or rejected drafts do not", async () => {
  resetEmpowerFlushForTests();
  const payload = payloadOf(buildEmpowerBumpPayload(baseInput({ draftId: "draft-flush", email: "ada@example.test" })));
  assert.deepEqual(empowerContactPatch(payload), { name: "Ada Lovelace", phone: "555-555-0100", email: "ada@example.test" });
  assert.equal("email" in empowerContactPatch({ name: "Ada", phone: "5555550100" }), false);
  const detail = read("app/components/LeadDetail.tsx");
  const submit = detail.slice(detail.indexOf("const handleEmpowerSubmit"), detail.indexOf("// Handle saving notes"));
  assert.match(submit, /empowerContactPatch/);
  assert.match(submit, /saveReportingPatch\(contact, false\)/);
  assert.match(detail, /EMPOWER_PENDING_LABEL/);
  const sync = read("app/empower/EmpowerBumpSync.tsx");
  const layout = read("app/layout.tsx");
  assert.match(layout, /EmpowerBumpSync/);
  assert.match(sync, /flushQueuedEmpowerBumps/);
  assert.match(sync, /addEventListener\('online'/);
  assert.match(sync, /visibilitychange/);
  assert.match(sync, /appStateChange/);
  assert.match(sync, /onAuthStateChanged/);
  assert.match(sync, /authStateReady/);
  assert.match(sync, /subscribeEmpowerAuthFlush/);
  assert.equal(read("app/field/useFieldData.ts").includes("flushQueuedEmpowerBumps"), false);

  const storage = memoryEmpowerStorage();
  let posts = 0;
  const ids: string[] = [];
  const offline = await deliverEmpowerBump(payload, {
    uid: "rep-1",
    storage,
    online: () => false,
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return jsonResponse(200);
    },
  });
  assert.equal(posts, 0);
  assert.equal(offline.status, "queued");
  assert.equal(offline.attempted, false);
  assert.equal(offline.status === "queued" && offline.message, EMPOWER_OFFLINE_MESSAGE);
  assert.equal(storedEmpowerState("draft-flush", storage, "rep-1"), "queued");
  assert.equal(empowerBumpPending("rep-1", "door-1", storage), true);
  assert.equal(empowerBumpPending("rep-2", "door-1", storage), false);

  storage.setItem("raydar.empowerBump.queue.v1", JSON.stringify({
    v: 1,
    drafts: [{ draftId: "legacy", state: "queued", payload }],
  }));
  await flushQueuedEmpowerBumps({
    uid: "rep-2",
    storage,
    online: () => true,
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return jsonResponse(200);
    },
  });
  assert.equal(posts, 0);

  const flushed = await flushQueuedEmpowerBumps({
    uid: "rep-1",
    storage,
    online: () => true,
    getToken: async () => "token",
    post: async (_path, init) => {
      posts += 1;
      ids.push(JSON.parse(String(init.body)).draftId);
      return jsonResponse(200, { ok: true });
    },
  });
  assert.equal(flushed, 1);
  assert.deepEqual(ids, ["draft-flush"]);
  assert.equal(storedEmpowerState("draft-flush", storage, "rep-1"), "sent");
  assert.equal(empowerBumpPending("rep-1", "door-1", storage), false);
  await flushQueuedEmpowerBumps({
    uid: "rep-1",
    storage,
    online: () => true,
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return jsonResponse(200);
    },
  });
  assert.equal(posts, 1);

  const held = memoryEmpowerStorage();
  await deliverEmpowerBump({ ...payload, draftId: "draft-before" }, {
    uid: "rep-1",
    storage: held,
    getToken: async () => "token",
    post: async () => {
      throw Object.assign(new Error("Failed to fetch"), { empowerPhase: "before-send" });
    },
  });
  assert.equal(storedEmpowerState("draft-before", held, "rep-1"), "queued");
  let resent = 0;
  await flushQueuedEmpowerBumps({
    uid: "rep-1",
    storage: held,
    online: () => true,
    getToken: async () => "token",
    post: async () => {
      resent += 1;
      return jsonResponse(404);
    },
  });
  assert.equal(resent, 1);
  assert.equal(storedEmpowerState("draft-before", held, "rep-1"), "queued");

  const ambiguous = memoryEmpowerStorage();
  await deliverEmpowerBump({ ...payload, draftId: "draft-drop" }, {
    uid: "rep-1",
    storage: ambiguous,
    getToken: async () => "token",
    post: async () => {
      throw Object.assign(new Error("socket hang up"), { empowerPhase: "after-send" });
    },
  });
  assert.equal(storedEmpowerState("draft-drop", ambiguous, "rep-1"), "ambiguous");
  await flushQueuedEmpowerBumps({
    uid: "rep-1",
    storage: ambiguous,
    online: () => true,
    getToken: async () => "token",
    post: async () => {
      resent += 1;
      return jsonResponse(200);
    },
  });
  assert.equal(resent, 1);

  const conflict = memoryEmpowerStorage();
  let conflictPosts = 0;
  const rejected = await deliverEmpowerBump({ ...payload, draftId: "draft-409" }, {
    uid: "rep-1",
    storage: conflict,
    getToken: async () => "token",
    post: async () => {
      conflictPosts += 1;
      return jsonResponse(409, { error: "This draft is already in flight." });
    },
  });
  assert.equal(conflictPosts, 1);
  assert.equal(rejected.status, "invalid");
  assert.equal(rejected.status === "invalid" && rejected.message, "This draft is already in flight.");
  assert.equal(storedEmpowerState("draft-409", conflict, "rep-1"), "rejected");
  await deliverEmpowerBump({ ...payload, draftId: "draft-409" }, {
    uid: "rep-1",
    storage: conflict,
    getToken: async () => "token",
    post: async () => {
      conflictPosts += 1;
      return jsonResponse(200);
    },
  });
  await flushQueuedEmpowerBumps({
    uid: "rep-1",
    storage: conflict,
    online: () => true,
    getToken: async () => "token",
    post: async () => {
      conflictPosts += 1;
      return jsonResponse(200);
    },
  });
  assert.equal(conflictPosts, 1);
  assert.equal(empowerBumpPending("rep-1", "door-1", conflict), false);

  let refreshedPosts = 0;
  const forbidden = await deliverEmpowerBump({ ...payload, draftId: "draft-403" }, {
    uid: "rep-1",
    storage: memoryEmpowerStorage(),
    getToken: async (force) => (force ? "fresh" : "stale"),
    post: async (_path, init) => {
      refreshedPosts += 1;
      const authorization = (init.headers as Record<string, string>).Authorization;
      if (refreshedPosts === 1) {
        assert.equal(authorization, "Bearer stale");
        return jsonResponse(401);
      }
      assert.equal(authorization, "Bearer fresh");
      return jsonResponse(403, { error: "Sign in again." });
    },
  });
  assert.equal(refreshedPosts, 2);
  assert.equal(forbidden.status, "signin");
  assert.match(detail, /\{EMPOWER_PENDING_LABEL\}/);
  assert.equal(EMPOWER_PENDING_LABEL, "Empower bump pending");
});

test("auth ready flushes a queued draft, 429 waits for Retry-After, and a short phone is rejected first", async () => {
  resetEmpowerFlushForTests();
  const payload = payloadOf(buildEmpowerBumpPayload(baseInput({ draftId: "draft-auth" })));
  const shortPhone = buildEmpowerBumpPayload(baseInput({ phone: "555-0100" }));
  assert.equal(shortPhone.ok, false);
  if (!shortPhone.ok) assert.match(shortPhone.message, /at least 10 digits/);
  const tenDigits = payloadOf(buildEmpowerBumpPayload(baseInput({ phone: "(555) 555-0100" })));
  assert.equal(tenDigits.phone.replace(/\D/g, "").length >= 10, true);

  const storage = memoryEmpowerStorage();
  let posts = 0;
  await deliverEmpowerBump(payload, {
    uid: "rep-1",
    storage,
    online: () => false,
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return jsonResponse(200);
    },
  });
  assert.equal(posts, 0);

  let signedIn = 0;
  let ready: () => void = () => {};
  const readyPromise = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const listeners: Array<(uid: string | null) => void> = [];
  const stop = subscribeEmpowerAuthFlush({
    subscribe: (listener) => {
      listeners.push(listener);
      listener(null);
      return () => {};
    },
    whenReady: () => readyPromise,
    onSignedIn: () => {
      signedIn += 1;
    },
  });
  assert.equal(signedIn, 0);
  ready();
  await readyPromise;
  await Promise.resolve();
  assert.equal(signedIn, 1);
  listeners[0]?.("rep-1");
  assert.equal(signedIn, 2);
  stop();

  await flushQueuedEmpowerBumps({
    uid: "",
    storage,
    online: () => true,
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return jsonResponse(200);
    },
  });
  assert.equal(posts, 0);
  await flushQueuedEmpowerBumps({
    uid: "rep-1",
    storage,
    online: () => true,
    now: () => 1_000,
    getToken: async () => "token",
    post: async (_path, init) => {
      posts += 1;
      const headers = init.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "draft-auth");
      return jsonResponse(404);
    },
  });
  assert.equal(posts, 1);
  assert.equal(storedEmpowerState("draft-auth", storage, "rep-1"), "queued");
  await flushQueuedEmpowerBumps({
    uid: "rep-1",
    storage,
    online: () => true,
    now: () => 1_000 + EMPOWER_MIN_RETRY_MS - 1,
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return jsonResponse(200);
    },
  });
  assert.equal(posts, 1);
  await flushQueuedEmpowerBumps({
    uid: "rep-1",
    storage,
    online: () => true,
    now: () => 1_000 + EMPOWER_MIN_RETRY_MS,
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return jsonResponse(200);
    },
  });
  assert.equal(posts, 2);

  const limited = memoryEmpowerStorage();
  const started = 5_000_000;
  const rate = await deliverEmpowerBump({ ...payload, draftId: "draft-429" }, {
    uid: "rep-1",
    storage: limited,
    now: () => started,
    getToken: async () => "token",
    post: async () => jsonResponse(429, { error: "Slow down." }, { "Retry-After": "15" }),
  });
  assert.equal(rate.status, "queued");
  assert.equal(rate.status === "queued" && rate.message, EMPOWER_RATE_MESSAGE);
  assert.equal(storedEmpowerState("draft-429", limited, "rep-1"), "queued");
  let ratePosts = 0;
  await flushQueuedEmpowerBumps({
    uid: "rep-1",
    storage: limited,
    online: () => true,
    now: () => started + 14_000,
    getToken: async () => "token",
    post: async () => {
      ratePosts += 1;
      return jsonResponse(200);
    },
  });
  assert.equal(ratePosts, 0);
  await flushQueuedEmpowerBumps({
    uid: "rep-1",
    storage: limited,
    online: () => true,
    now: () => started + 15_000,
    getToken: async () => "token",
    post: async () => {
      ratePosts += 1;
      return jsonResponse(200);
    },
  });
  assert.equal(ratePosts, 1);

  const conflict = await deliverEmpowerBump({ ...payload, draftId: "draft-notice" }, {
    uid: "rep-1",
    storage: memoryEmpowerStorage(),
    getToken: async () => "token",
    post: async () => jsonResponse(409, { error: "This draft is already in flight." }),
  });
  assert.equal(conflict.status, "invalid");
  assert.match(empowerNotice(conflict), /The door was saved\./);

  const legacy = memoryEmpowerStorage();
  const untouched = JSON.stringify({
    v: 1,
    drafts: [{ draftId: "stray", state: "queued", payload }],
  });
  legacy.setItem("raydar.empowerBump.queue.v1", untouched);
  legacy.setItem("raydar.empowerBump.queue.v1.rep-9", JSON.stringify({
    v: 1,
    uid: "rep-9",
    drafts: [{ draftId: "owned", state: "queued", payload: { ...payload, draftId: "owned" }, uid: "rep-9" }],
  }));
  let migrated = 0;
  await flushQueuedEmpowerBumps({
    uid: "rep-9",
    storage: legacy,
    online: () => true,
    getToken: async () => "token",
    post: async (_path, init) => {
      migrated += 1;
      assert.equal(JSON.parse(String(init.body)).draftId, "owned");
      return jsonResponse(200);
    },
  });
  assert.equal(migrated, 1);
  assert.equal(legacy.getItem("raydar.empowerBump.queue.v1"), untouched);
});

test("release 14.27 build 171 is the same number in the app, iOS, and Android", () => {
  const release = JSON.parse(read("app/mobile/_lib/release.json"));
  assert.equal(release.version, "14.27");
  assert.equal(release.build, 171);
  const project = read("ios/App/App.xcodeproj/project.pbxproj");
  assert.deepEqual([...project.matchAll(/MARKETING_VERSION = ([0-9.]+);/g)].map((match) => match[1]), ["14.27", "14.27"]);
  assert.deepEqual([...project.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((match) => match[1]), ["171", "171"]);
  const gradle = read("android/app/build.gradle");
  assert.match(gradle, /versionName "14\.27"/);
  assert.match(gradle, /versionCode 171\b/);
  const hash = createHash("sha256").update(read("app/utils/knockCount.ts")).digest("hex");
  assert.equal(hash, KNOCK_COUNT_SHA);
});
