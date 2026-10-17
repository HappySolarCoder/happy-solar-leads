import test from "node:test";
import assert from "node:assert/strict";
import {
  backgroundAssignmentUnavailable,
  retryTerritoryAssignment,
  saveTerritoryAssignment,
  TerritoryAssignmentPaused,
} from "../../app/mobile/territories/assignAction.ts";
import type { TerritoryPoint } from "../../app/types/territory.ts";
import type { ManagedTerritory } from "../../app/utils/territoryManager.ts";

const polygon: TerritoryPoint[] = [
  { lat: 43.15, lng: -77.62 },
  { lat: 43.15, lng: -77.6 },
  { lat: 43.17, lng: -77.6 },
  { lat: 43.17, lng: -77.62 },
];
const requestId = "11111111-1111-4111-8111-111111111111";
const rep = { id: "rep", name: "Rep", color: "#B28437", role: "setter", team: "East", isActive: true, approved: true };
const nextRep = { id: "next", name: "Next", color: "#587E98", role: "setter", team: "East", isActive: true, approved: true };

function httpError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function territory(overrides: Partial<ManagedTerritory> = {}): ManagedTerritory {
  return {
    id: "area-1",
    name: "Maple",
    userId: "rep",
    userName: "Rep",
    userColor: "#B28437",
    polygon: polygon.map((point) => ({ ...point })),
    leadIds: [],
    version: "10:1",
    ...overrides,
  };
}

function harness(options: {
  background?: boolean;
  fail?: Record<string, Error>;
  queueError?: string;
  pages?: Array<{ changed: number; skipped?: number; scanned: number; done: boolean }>;
  continueFailAt?: number;
  areas?: ManagedTerritory[];
  members?: Array<typeof rep>;
} = {}) {
  const calls: Array<Record<string, unknown> | null> = [];
  const pages = (options.pages || [{ changed: 4, skipped: 2, scanned: 4, done: true }]).map((page) => ({ ...page }));
  let continues = 0;
  const summary = {
    capabilities: { pagedAssignments: true, backgroundAssignments: !!options.background },
    members: options.members || [rep, nextRep],
    territories: options.areas || [],
  };
  const request = async <T,>(body?: Record<string, unknown>): Promise<T> => {
    calls.push(body ? { ...body } : null);
    if (!body) return structuredClone(summary) as T;
    const action = String(body.action);
    if (options.fail?.[action]) throw options.fail[action];
    if (action === "save-background-assignment" || action === "begin-assignment") {
      const id = String(body.kind === "create" ? body.requestId : body.id);
      const current = summary.territories.find((area) => area.id === id);
      if (body.kind === "transfer") {
        if (!current) throw httpError("This territory is no longer in your list.", 404);
        current.assignment = {
          id: String(body.requestId),
          done: false,
          changed: current.assignment?.changed || 0,
          scanned: current.assignment?.scanned || 0,
          targetId: String(body.userId),
        };
      } else if (!current) {
        summary.territories.push(territory({
          id,
          name: String(body.name),
          userId: String(body.userId),
          polygon: structuredClone(body.polygon) as TerritoryPoint[],
          version: "2:0",
          assignment: { id: String(body.requestId), done: false, changed: 0, scanned: 0, targetId: String(body.userId) },
        }));
      }
      return {
        id,
        operationId: String(body.requestId),
        changed: 0,
        skipped: 0,
        scanned: 0,
        done: false,
        background: action === "save-background-assignment",
        queued: action === "save-background-assignment" && !options.queueError,
        queueError: action === "save-background-assignment" ? options.queueError || "" : "",
      } as T;
    }
    if (action === "continue-assignment") {
      continues += 1;
      if (options.continueFailAt === continues) throw new Error("The connection dropped.");
      const page = pages.shift() || { changed: 4, skipped: 1, scanned: 4, done: true };
      const current = summary.territories.find((area) => area.id === body.id);
      if (current?.assignment) {
        current.assignment = { ...current.assignment, done: page.done, changed: page.changed, scanned: page.scanned };
      }
      return { id: body.id, operationId: body.operationId, skipped: page.skipped || 0, ...page } as T;
    }
    if (action === "retry-background-assignment") {
      return {
        id: body.id,
        changed: 3,
        skipped: 1,
        scanned: 3,
        done: false,
        background: true,
        queued: !options.queueError,
        queueError: options.queueError || "",
      } as T;
    }
    throw new Error(`unexpected ${action}`);
  };
  return {
    request,
    calls,
    summary,
    actions: () => calls.filter((call): call is Record<string, unknown> => !!call).map((call) => call.action),
    summaries: () => calls.filter((call) => call === null).length,
  };
}

const create = { kind: "create" as const, name: " Maple Street ", userId: "rep", polygon, requestId };

test("background availability is only the unknown-action and configuration responses", () => {
  assert.equal(backgroundAssignmentUnavailable(httpError("Unknown territory action.", 400)), true);
  assert.equal(backgroundAssignmentUnavailable(httpError("Background assignment needs the v14.9 backend configuration. Your drawing is unchanged.", 503)), true);
  assert.equal(backgroundAssignmentUnavailable(httpError("Choose a rep.", 400)), false);
  assert.equal(backgroundAssignmentUnavailable(httpError("This territory changed. Refresh before transferring.", 409)), false);
  assert.equal(backgroundAssignmentUnavailable(new Error("Failed to fetch")), false);
});

test("a fresh background capability wins over the value from when the screen opened", async () => {
  const on = harness({ background: true });
  const saved = await saveTerritoryAssignment(on.request, create);
  assert.deepEqual(on.actions(), ["save-background-assignment"]);
  assert.equal(on.summaries(), 1);
  assert.equal(saved.background, true);
  assert.match(saved.message, /assigning in the background/);
  const body = on.calls[1] as Record<string, unknown>;
  assert.equal(body.name, "Maple Street");
  assert.deepEqual(body.polygon, polygon);
  assert.equal(body.requestId, requestId);
  assert.equal(body.action === "create", false);

  const off = harness({ background: false, areas: [territory()] });
  const paged = await saveTerritoryAssignment(off.request, { kind: "transfer", id: "area-1", version: "10:1", userId: "next", requestId });
  assert.deepEqual(off.actions(), ["begin-assignment", "continue-assignment"]);
  assert.equal(off.summaries(), 1);
  assert.equal(paged.background, false);
  assert.match(paged.message, /this phone finished the save/);
  assert.match(paged.message, /4 pins assigned/);
  assert.match(paged.message, /2 worked or changed pins/);
  const transfer = off.calls[1] as Record<string, unknown>;
  assert.equal(transfer.version, "10:1");
  assert.equal(transfer.userId, "next");
  assert.equal("polygon" in transfer, false);
  assert.deepEqual(off.summary.territories[0].polygon, polygon);
});

test("rollback and a missing queue fall back once, without the retired create action", async () => {
  for (const error of [
    httpError("Unknown territory action.", 400),
    httpError("Background assignment needs the v14.9 backend configuration. Your drawing is unchanged.", 503),
  ]) {
    const flow = harness({ background: true, fail: { "save-background-assignment": error } });
    const saved = await saveTerritoryAssignment(flow.request, create);
    assert.deepEqual(flow.actions(), ["save-background-assignment", "begin-assignment", "continue-assignment"]);
    assert.equal(flow.summaries(), 1);
    assert.equal(saved.id, requestId);
    assert.deepEqual((flow.calls[2] as { polygon: TerritoryPoint[] }).polygon, polygon);
    assert.equal(flow.actions().includes("create"), false);
    assert.equal(flow.actions().includes("preview"), false);
    assert.equal(flow.actions().includes("preview-v2"), false);
  }
});

test("conflicts, validation, and ambiguous network errors do not start a second assignment", async () => {
  const overlap = harness({ background: true, fail: { "save-background-assignment": httpError("This boundary overlaps a saved territory.", 409) } });
  await assert.rejects(saveTerritoryAssignment(overlap.request, create), /overlaps/);
  assert.deepEqual(overlap.actions(), ["save-background-assignment"]);

  const network = harness({ background: true, fail: { "save-background-assignment": new Error("Failed to fetch") } });
  await assert.rejects(saveTerritoryAssignment(network.request, create), /Failed to fetch/);
  assert.deepEqual(network.actions(), ["save-background-assignment"]);

  const rejected = harness({ background: true, fail: { "save-background-assignment": httpError("Choose a rep.", 400) } });
  await assert.rejects(saveTerritoryAssignment(rejected.request, create), /Choose a rep/);
  assert.deepEqual(rejected.actions(), ["save-background-assignment"]);
  assert.match((await saveTerritoryAssignment(harness({ members: [{ ...rep, isActive: false }] }).request, create).catch((error) => error)).message, /drawing is unchanged/);

  const stale = harness({ background: true, areas: [territory({ version: "10:2" })] });
  await assert.rejects(
    saveTerritoryAssignment(stale.request, { kind: "transfer", id: "area-1", version: "10:1", userId: "next", requestId }),
    /not changed/,
  );
  assert.deepEqual(stale.actions(), []);
  assert.deepEqual(stale.summary.territories[0].polygon, polygon);

  const invalid = harness({ background: true });
  await assert.rejects(
    saveTerritoryAssignment(invalid.request, { ...create, polygon: [polygon[0]] }),
    /unchanged/,
  );
  assert.equal(invalid.calls.length, 0);
});

test("a queue failure keeps the saved boundary and does not scan on the phone", async () => {
  const flow = harness({ background: true, queueError: "Territory saved, but background processing could not start. Select it and tap Retry background assignment." });
  const saved = await saveTerritoryAssignment(flow.request, create);
  assert.deepEqual(flow.actions(), ["save-background-assignment"]);
  assert.match(saved.message, /Retry background assignment/);
  assert.deepEqual(flow.summary.territories[0].polygon, polygon);
  assert.equal(flow.summary.territories[0].assignment?.scanned, 0);
});

test("paged assignment stays on one operation and resumes after a dropped page", async () => {
  const flow = harness({
    background: false,
    continueFailAt: 1,
    pages: [
      { changed: 2, skipped: 1, scanned: 200, done: false },
      { changed: 5, skipped: 1, scanned: 220, done: true },
    ],
  });
  await assert.rejects(saveTerritoryAssignment(flow.request, create), (error: unknown) => {
    assert.ok(error instanceof TerritoryAssignmentPaused);
    assert.equal(error.boundarySaved, true);
    assert.match(error.message, /Nothing was discarded/);
    assert.equal(error.progress.id, requestId);
    return true;
  });
  assert.deepEqual(flow.summary.territories[0].polygon, polygon);
  flow.summary.capabilities.backgroundAssignments = true;
  const resumed = await saveTerritoryAssignment(flow.request, create);
  assert.equal(flow.actions().filter((action) => action === "begin-assignment").length, 1);
  assert.equal(flow.actions().includes("retry-background-assignment"), true);
  assert.equal(resumed.background, true);
  assert.match(resumed.message, /leave this screen/);
  assert.equal(flow.calls.filter((call) => call && "polygon" in call).length, 1);
});

test("several pages use one capability read and stop when a page does not advance", async () => {
  const flow = harness({
    background: false,
    pages: [
      { changed: 1, skipped: 0, scanned: 200, done: false },
      { changed: 2, skipped: 0, scanned: 400, done: false },
      { changed: 3, skipped: 1, scanned: 450, done: true },
    ],
  });
  const saved = await saveTerritoryAssignment(flow.request, create);
  assert.equal(flow.summaries(), 1);
  assert.equal(flow.actions().filter((action) => action === "continue-assignment").length, 3);
  assert.equal(saved.changed, 3);
  const stalled = harness({ background: false, pages: [{ changed: 0, skipped: 0, scanned: 0, done: false }] });
  await assert.rejects(saveTerritoryAssignment(stalled.request, create), TerritoryAssignmentPaused);
  assert.equal(stalled.actions().filter((action) => action === "continue-assignment").length, 1);
});

test("retry follows the current capability and never begins a second assignment", async () => {
  const pending = territory({
    assignment: { id: "job-1", done: false, changed: 8, scanned: 200, targetId: "rep" },
  });
  const background = harness({ background: true, areas: [structuredClone(pending)] });
  const queued = await retryTerritoryAssignment(background.request, pending);
  assert.deepEqual(background.actions(), ["retry-background-assignment"]);
  assert.match(queued.message, /leave this screen/);
  assert.equal(background.calls.some((call) => call && "polygon" in call), false);

  const phone = harness({ background: false, areas: [structuredClone(pending)] });
  const finished = await retryTerritoryAssignment(phone.request, pending);
  assert.deepEqual(phone.actions(), ["continue-assignment"]);
  assert.equal((phone.calls[1] as { operationId: string }).operationId, "job-1");
  assert.match(finished.message, /finished on this phone/);
  assert.deepEqual(phone.summary.territories[0].polygon, polygon);

  const rolled = harness({
    background: true,
    areas: [structuredClone(pending)],
    fail: { "retry-background-assignment": httpError("Unknown territory action.", 400) },
  });
  await retryTerritoryAssignment(rolled.request, pending);
  assert.deepEqual(rolled.actions(), ["retry-background-assignment", "continue-assignment"]);
  assert.equal(rolled.actions().includes("begin-assignment"), false);

  const done = harness({
    background: true,
    areas: [territory({ assignment: { id: "job-1", done: true, changed: 8, scanned: 200, targetId: "rep" } })],
  });
  const complete = await retryTerritoryAssignment(done.request, pending);
  assert.deepEqual(done.actions(), []);
  assert.match(complete.message, /already complete/);
});

test("a lost acknowledgement resumes the same operation instead of beginning another", async () => {
  const flow = harness({
    background: true,
    fail: { "save-background-assignment": httpError("This request was already used for another assignment.", 409) },
  });
  const saved = await saveTerritoryAssignment(flow.request, create);
  assert.deepEqual(flow.actions(), ["save-background-assignment", "retry-background-assignment"]);
  assert.equal(flow.actions().includes("begin-assignment"), false);
  assert.match(saved.message, /leave this screen/);
});

test("a server without either assignment path leaves the drawing unchanged", async () => {
  const flow = harness({
    background: true,
    fail: {
      "save-background-assignment": httpError("Unknown territory action.", 400),
      "begin-assignment": httpError("Unknown territory action.", 400),
    },
  });
  await assert.rejects(saveTerritoryAssignment(flow.request, create), /drawing is unchanged/);
  assert.deepEqual(flow.actions(), ["save-background-assignment", "begin-assignment"]);
  assert.equal(flow.summary.territories.length, 0);
});

test("an unfinished assignment blocks a second transfer and keeps the boundary", async () => {
  const flow = harness({
    background: true,
    areas: [territory({ assignment: { id: "other-job", done: false, changed: 1, scanned: 20, targetId: "rep" } })],
  });
  await assert.rejects(
    saveTerritoryAssignment(flow.request, { kind: "transfer", id: "area-1", version: "10:1", userId: "next", requestId }),
    /Retry assignment/,
  );
  assert.deepEqual(flow.actions(), []);
  assert.deepEqual(flow.summary.territories[0].polygon, polygon);
  assert.equal(flow.summary.territories[0].assignment?.id, "other-job");
});
