import test from "node:test";
import assert from "node:assert/strict";
import { deliverFieldDispo } from "../../app/field/serverDispo";
import { SYNC_REASON } from "../../app/field/syncReasons";
import { syncOutbox } from "../../app/field/syncOutbox";
import type { PendingMutation } from "../../app/field/types";
import type { User } from "../../app/types";

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
    direct: { patch: { status: "not-home", gpsVerified: true, gpsDistanceM: 12 } },
    ...patch,
  };
}

function json(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function denied() {
  return Object.assign(Error("permission-denied"), { code: "permission-denied", status: 403 });
}

test("a second knock that changes gps flags saves through the plain patch after the route rejects it", async () => {
  for (const id of ["territory-pin", "manager-pin"]) {
    let commits = 0;
    let sawFull = false;
    const saved = await deliverFieldDispo(knock({ id, leadId: id }), user, {
      getToken: async () => "token",
      commit: async (draft) => {
        commits += 1;
        if (commits === 1) {
          sawFull = draft.direct?.patch.gpsVerified === true && draft.direct?.patch.gpsDistanceM === 12;
          throw denied();
        }
        assert.equal(draft.direct?.patch.gpsVerified, undefined);
        assert.equal(draft.direct?.patch.gpsDistanceM, undefined);
        assert.equal(draft.direct?.patch.status, "not-home");
        return { replayed: false };
      },
      post: async (_path, init) => {
        const body = JSON.parse(String(init.body)) as { kind?: string; gpsVerified?: boolean; gpsDistanceM?: number };
        assert.equal(body.kind, "knock");
        assert.equal(body.gpsVerified, undefined);
        assert.equal(body.gpsDistanceM, undefined);
        return json(id === "manager-pin" ? 500 : 403, { reasonCode: SYNC_REASON.permissionDenied });
      },
    });
    assert.equal(sawFull, true);
    assert.equal(saved.replayed, false);
    assert.equal(commits, 2);
  }
});

test("route-first pins follow the route only after the plain patch is also denied", async () => {
  const cases: Array<{ status: number; body?: unknown; state: string; reason?: string; hold?: boolean }> = [
    { status: 404, state: "queued", hold: true },
    { status: 503, state: "retry" },
    { status: 429, state: "retry" },
    { status: 400, state: "parked", reason: SYNC_REASON.invalidPayload },
    { status: 403, body: { reasonCode: SYNC_REASON.historicalPin }, state: "parked", reason: SYNC_REASON.historicalPin },
    { status: 410, state: "parked", reason: SYNC_REASON.notFound },
  ];
  for (const [index, item] of cases.entries()) {
    const historical = index % 2 === 0;
    let plainTried = false;
    let rows = [knock({
      id: `route-${item.status}-${index}`,
      direct: {
        patch: { status: "not-home", gpsVerified: false, gpsUnverifiedReason: "too_far", gpsDistanceM: 90 },
        serverDispo: true,
      },
    })];
    await syncOutbox({
      now: () => Date.parse(at),
      random: () => 0,
      read: async () => rows,
      send: async (row) => deliverFieldDispo(row, user, {
        getToken: async () => "token",
        commit: async () => {
          plainTried = true;
          throw Object.assign(Error(historical ? "Historical pins cannot be dispositioned" : "permission-denied"), {
            code: "permission-denied",
            status: 403,
          });
        },
        post: async () => json(item.status, item.body || {}),
      }),
      remove: async () => { throw Error("must not remove"); },
      update: async (row) => { rows = [row]; },
      report: async () => {},
      active: () => true,
    });
    assert.equal(plainTried, true, String(item.status));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].createdAt, at);
    assert.equal(rows[0].status, "not-home");
    assert.equal(rows[0].syncState, item.state, String(item.status));
    if (item.reason) assert.equal(rows[0].parkedReason, item.reason, String(item.status));
    if (item.hold) assert.equal(rows[0].routeHold, "field-dispo");
    assert.equal(rows[0].direct?.patch.gpsUnverifiedReason, "too_far");
  }

  let commits = 0;
  const accepted = await deliverFieldDispo(knock({
    direct: { patch: { status: "not-home" }, serverDispo: true },
  }), user, {
    getToken: async () => "token",
    commit: async () => { commits += 1; return { replayed: false }; },
    post: async () => json(200, { result: "applied" }),
  });
  assert.equal(accepted.replayed, false);
  assert.equal(commits, 0);
});

test("a temporary plain-patch failure stays queued instead of parking on the route", async () => {
  let commits = 0;
  let rows = [knock({
    id: "plain-offline",
    direct: { patch: { status: "not-home", gpsVerified: true, gpsDistanceM: 12 } },
  })];
  await syncOutbox({
    now: () => Date.parse(at),
    random: () => 0,
    read: async () => rows,
    send: async (row) => deliverFieldDispo(row, user, {
      getToken: async () => "token",
      commit: async () => {
        commits += 1;
        if (commits === 1) throw denied();
        throw Object.assign(Error("client is offline"), { code: "unavailable", status: 503 });
      },
      post: async () => json(400, {}),
    }),
    remove: async () => { throw Error("must not remove"); },
    update: async (row) => { rows = [row]; },
    report: async () => {},
    active: () => true,
  });
  assert.equal(commits, 2);
  assert.equal(rows[0].syncState, "retry");
  assert.equal(rows[0].parkedReason, undefined);
  assert.equal(rows[0].status, "not-home");
  assert.equal(rows[0].createdAt, at);
});
