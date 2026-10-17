import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Lead, User } from "../../app/types";
import {
  directoryAccessLimited,
  readUserDirectory,
  resetDirectoryDenialForTests,
} from "../../app/utils/directoryUsers";
import {
  membersFromActiveUsers,
  ownTeamMember,
  resetTeamDirectoryDenialForTests,
  subscribeActiveTeamLocations,
  TEAM_VIEW_UNAVAILABLE,
  type TeamLocationSnapshot,
} from "../../app/utils/teamDirectory";
import {
  countRecordForViewer,
  ensureViewerPerformanceRow,
  leadActorIds,
  scopeTeamTotals,
} from "../../app/utils/testAccount";
import { calculateDailyMetrics } from "../../app/utils/aiManager";
import {
  beginSchedulingSend,
  resetSchedulingAccessForTests,
  resolveSchedulingRead,
  schedulingAction,
  SCHEDULING_UNAVAILABLE_MESSAGE,
} from "../../app/utils/schedulingAccess";
import { HomeownerLoader, type HomeownerState } from "../../app/homeowners/loader";
import {
  HOMEOWNER_LIMITED_NOTE,
  homeownersAccessDenied,
  resetHomeownersAccessForTests,
} from "../../app/homeowners/access";
import { readHomeownerRange } from "../../app/homeowners/source";
import type { HomeTile, View } from "../../app/homeowners/model";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const denied = (code = "permission-denied") => Object.assign(new Error("denied"), { code });
const own = {
  id: "demo",
  name: "Demo",
  email: "demo@example.com",
  color: "#52738e",
  role: "setter",
  team: "TEST",
  isTestAccount: true,
  testData: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
} as User;

test("a denied user list falls back to the signed-in profile and does not list again", async () => {
  resetDirectoryDenialForTests();
  try {
    let lists = 0;
    const directory = {
      listUsers: async () => {
        lists += 1;
        throw denied("firestore/permission-denied");
      },
      ownUser: async () => own,
    };
    const first = await readUserDirectory("demo", directory);
    const second = await readUserDirectory("demo", directory);
    assert.deepEqual(first.map((user) => user.id), ["demo"]);
    assert.deepEqual(second.map((user) => user.id), ["demo"]);
    assert.equal(lists, 1);
    assert.equal(directoryAccessLimited("demo"), true);
    assert.equal(directoryAccessLimited("manager"), false);
    let managerLists = 0;
    const manager = await readUserDirectory("manager", {
      listUsers: async () => {
        managerLists += 1;
        return [{ ...own, id: "manager", team: "Rochester", isTestAccount: false, testData: false }];
      },
      ownUser: async () => null,
    });
    assert.equal(managerLists, 1);
    assert.equal(manager[0].id, "manager");
    await assert.rejects(() => readUserDirectory("other", {
      listUsers: async () => { throw new Error("offline"); },
      ownUser: async () => own,
    }));
    assert.equal(directoryAccessLimited("other"), false);
  } finally {
    resetDirectoryDenialForTests();
  }
});

test("the team-location listener attaches once and does not reattach after permission-denied", () => {
  resetTeamDirectoryDenialForTests();
  try {
    let attaches = 0;
    let unsubs = 0;
    let fail: (error: unknown) => void = () => {};
    const events: string[] = [];
    const attach = (_onNext: (snapshot: TeamLocationSnapshot) => void, onError: (error: unknown) => void) => {
      attaches += 1;
      fail = onError;
      return () => { unsubs += 1; };
    };
    const options = {
      viewerId: "demo",
      attach,
      onNext: () => events.push("next"),
      onDenied: () => events.push("denied"),
      onUnavailable: () => events.push("unavailable"),
    };
    subscribeActiveTeamLocations(options);
    fail(denied());
    assert.equal(attaches, 1);
    assert.equal(unsubs, 1);
    assert.deepEqual(events, ["denied"]);
    subscribeActiveTeamLocations(options);
    assert.equal(attaches, 1);
    assert.deepEqual(events, ["denied", "denied"]);
    let otherAttaches = 0;
    subscribeActiveTeamLocations({
      ...options,
      viewerId: "manager",
      attach: () => {
        otherAttaches += 1;
        return () => {};
      },
    });
    assert.equal(otherAttaches, 1);
    const located = ownTeamMember({
      ...own,
      currentLocation: { lat: 43.15, lng: -77.6, timestamp: new Date("2026-10-17T15:00:00Z") },
    });
    assert.equal(located?.id, "demo");
    assert.equal(ownTeamMember({ ...own, currentLocation: { lat: 43.15, lng: -77.6 } }), null);
    const docs = [
      { id: "demo", data: () => ({ name: "Demo", team: "TEST", isTestAccount: true, currentLocation: { lat: 43.15, lng: -77.6, timestamp: new Date("2026-10-17T15:00:00Z") } }) },
      { id: "real", data: () => ({ name: "Riley", team: "Rochester", currentLocation: { lat: 43.16, lng: -77.61, timestamp: new Date("2026-10-17T15:00:00Z") } }) },
    ];
    assert.deepEqual(membersFromActiveUsers(docs, { id: "manager", team: "Rochester" }).map((member) => member.id), ["real"]);
    assert.deepEqual(membersFromActiveUsers(docs, own).map((member) => member.id), ["demo"]);
    assert.equal(TEAM_VIEW_UNAVAILABLE, "Team view isn't available for this account.");
  } finally {
    resetTeamDirectoryDenialForTests();
  }
});

test("a homeowner denial is remembered for that account and the next pan does not query", async () => {
  resetHomeownersAccessForTests();
  try {
    const view: View = { south: 43.15, north: 43.154, west: -77.605, east: -77.6, zoom: 17 };
    const empty = (tile: string): HomeTile => ({ tile, docs: {}, receipts: [], touched: 0 });
    let fetches = 0;
    const deps = {
      accountId: "demo",
      read: async (tile: string) => empty(tile),
      save: async () => {},
      online: () => true,
      fetch: async () => {
        fetches += 1;
        throw denied("firestore/permission-denied");
      },
    };
    const run = (loader: HomeownerLoader) => new Promise<HomeownerState>((resolve) => {
      loader.request(view, (state) => { if (!state.loading) resolve(state); });
    });
    const first = await run(new HomeownerLoader(deps));
    const second = await run(new HomeownerLoader(deps));
    assert.equal(fetches, 1);
    assert.equal(first.error, HOMEOWNER_LIMITED_NOTE);
    assert.equal(second.error, HOMEOWNER_LIMITED_NOTE);
    assert.equal(homeownersAccessDenied("demo"), true);
    assert.equal(second.queries, 0);
    let realFetches = 0;
    await run(new HomeownerLoader({
      ...deps,
      accountId: "real",
      fetch: async () => {
        realFetches += 1;
        return { docs: [], rawCount: 0 };
      },
    }));
    assert.ok(realFetches > 0);
    await assert.rejects(
      () => readHomeownerRange({ lo: 0, hi: 1 }, 1, "demo"),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "permission-denied");
        assert.equal((error as Error).message, HOMEOWNER_LIMITED_NOTE);
        return true;
      },
    );
  } finally {
    resetHomeownersAccessForTests();
  }
});

test("an adminSettings denial disables scheduling and does not supply a webhook or phone", async () => {
  resetSchedulingAccessForTests();
  try {
    let reads = 0;
    const read = async () => {
      reads += 1;
      throw denied();
    };
    const first = await resolveSchedulingRead("demo", read);
    const second = await resolveSchedulingRead("demo", read);
    const action = schedulingAction(first);
    assert.equal(first.status, "denied");
    assert.equal(second.status, "denied");
    assert.equal(reads, 1);
    assert.equal(action.sendEnabled, false);
    assert.equal(action.phone, null);
    assert.equal(action.webhook, null);
    assert.equal(action.message, SCHEDULING_UNAVAILABLE_MESSAGE);
    assert.equal(beginSchedulingSend(false, action), "disabled");
    assert.equal(beginSchedulingSend(true, { sendEnabled: true, webhook: "https://example.test/hook" }), "disabled");
    const ready = await resolveSchedulingRead("manager", async () => ({
      notificationWebhook: "https://example.test/hook",
      schedulingManagerPhone: "5551234567",
    }));
    assert.equal(ready.status, "ready");
    assert.equal(beginSchedulingSend(false, schedulingAction(ready)), "send");
    assert.equal(beginSchedulingSend(false, schedulingAction({ status: "missing" })), "unconfigured");
  } finally {
    resetSchedulingAccessForTests();
  }
});

test("test accounts and their knocks stay out of a real user's totals", () => {
  const real = { id: "real", name: "Riley", team: "Rochester" };
  const demo = { id: "demo", name: "Demo", team: "TEST", isTestAccount: true, testData: true };
  const flagged = { id: "flagged", name: "Flag", isTestAccount: true, team: "East" };
  const leads = [
    { id: "real-knock", claimedBy: "real" },
    { id: "demo-flagged", claimedBy: "demo", testData: true },
    { id: "demo-owned", claimedBy: "demo" },
    { id: "flagged-owned", claimedBy: "flagged", testData: true },
  ];
  const scoped = scopeTeamTotals({
    viewer: real,
    users: [real, demo, flagged],
    records: leads,
    actorIds: (lead) => leadActorIds(lead),
  });
  assert.deepEqual(scoped.users.map((user) => user.id), ["real"]);
  assert.deepEqual(scoped.records.map((lead) => lead.id), ["real-knock"]);
  const ownView = scopeTeamTotals({
    viewer: demo,
    users: [real, demo, flagged],
    records: leads,
    actorIds: (lead) => leadActorIds(lead),
  });
  assert.deepEqual(ownView.users.map((user) => user.id), ["demo"]);
  assert.deepEqual(ownView.records.map((lead) => lead.id), ["demo-flagged", "demo-owned"]);
  assert.equal(countRecordForViewer(real, { testData: true }), false);
  assert.equal(countRecordForViewer(demo, { testData: true }), true);
  const rows = ensureViewerPerformanceRow([], real, true, (viewer) => ({ userId: viewer.id, knocks: 0 }));
  assert.deepEqual(rows, [{ userId: "real", knocks: 0 }]);
  assert.equal(ensureViewerPerformanceRow(rows, real, true, () => ({ userId: "real", knocks: 1 })).length, 1);
  assert.equal(ensureViewerPerformanceRow([], real, false, () => ({ userId: "real", knocks: 0 })).length, 0);
  const when = new Date("2026-10-17T15:00:00Z");
  const metrics = calculateDailyMetrics("real", "Riley", [
    { id: "t", claimedBy: "real", testData: true, knockGpsTimestamp: when, disposition: "appointment", lat: 1, lng: 1, status: "appointment", name: "", address: "", city: "", state: "", zip: "", createdAt: when } as Lead,
    { id: "r", claimedBy: "real", knockGpsTimestamp: when, disposition: "not home", lat: 1, lng: 2, status: "not-home", name: "", address: "", city: "", state: "", zip: "", createdAt: when } as Lead,
  ], when);
  assert.equal(metrics.doorsKnocked, 1);
});

test("rep screens share the directory fallback and scheduling stays disabled in the editor", () => {
  const firestore = readFileSync(path.join(root, "app/utils/firestore.ts"), "utf8");
  const storage = readFileSync(path.join(root, "app/utils/storage.ts"), "utf8");
  const teamMap = readFileSync(path.join(root, "app/team-map/page.tsx"), "utf8");
  const modal = readFileSync(path.join(root, "app/components/LeadEditorModal.tsx"), "utf8");
  const goals = readFileSync(path.join(root, "app/utils/goals.ts"), "utf8");
  const loader = readFileSync(path.join(root, "app/homeowners/loader.ts"), "utf8");
  assert.match(firestore, /readUserDirectory/);
  assert.match(storage, /isPermissionDenied\(error\)/);
  assert.match(teamMap, /subscribeActiveTeamLocations/);
  assert.match(teamMap, /TEAM_VIEW_UNAVAILABLE/);
  assert.doesNotMatch(loader, /Homeowner access is not enabled/);
  assert.match(loader, /homeownersAccessDenied/);
  assert.match(goals, /countRecordForViewer/);
  const guardAt = modal.indexOf("beginSchedulingSend(");
  const sendAt = modal.indexOf("sendSchedulingWebhook(");
  assert.ok(guardAt !== -1 && guardAt < sendAt);
  assert.match(modal, /disabled=\{isSending \|\| schedulingUnavailable\}/);
  assert.match(modal, /SCHEDULING_UNAVAILABLE_MESSAGE/);
  for (const file of [
    "app/setter-stats/page.tsx",
    "app/components/LeadDetail.tsx",
    "app/components/ActivityStream.tsx",
    "app/mobile/knocking/page.tsx",
    "app/objections/page.tsx",
    "app/go-backs/page.tsx",
    "app/utils/goals.ts",
  ]) {
    assert.match(readFileSync(path.join(root, file), "utf8"), /getUsersAsync/);
  }
  for (const file of [
    "app/setter-stats/page.tsx",
    "app/dashboard/page.tsx",
    "app/activity-map/page.tsx",
    "app/ai-manager/page.tsx",
  ]) {
    assert.match(readFileSync(path.join(root, file), "utf8"), /scopeTeamTotals/);
  }
});
