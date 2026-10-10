import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { fakeAdmin } from "./fake-admin";
import {
  DEFAULT_FIELD_CONFIG,
  FEATURE_KEYS,
  type FieldConfig,
  type FieldMutation,
  type FieldObservation,
} from "../../app/field/types";
import { cleanConfig } from "../../app/field/config";
import {
  contactWindows,
  fieldEvents,
  funnel,
  localParts,
  pilotFlags,
  revisitDoors,
  scoreDoor,
  savingsPreview,
} from "../../app/field/analysis";
import { overlayDrafts } from "../../app/field/deviceStore";
import { syncOutbox } from "../../app/field/syncOutbox";
import { DEFAULT_DISPOSITIONS } from "../../app/types/disposition";
import type { Lead } from "../../app/types";
import { createFieldHandlers } from "../../app/utils/server/fieldWork";
import { createFieldConfigHandlers } from "../../app/utils/server/fieldConfig";
import {
  createRecoveryHandlers,
  openTicket,
  sealTicket,
} from "../../app/utils/server/fieldRecovery";
const now = new Date("2026-10-10T21:00:00Z");
test('outbox drains changes added in flight and never discards transient failures',async()=>{
  let queue=[mutation()],sent:string[]=[];
  const deps={read:async()=>[...queue],send:async(m:FieldMutation)=>{sent.push(m.id);if(m.id==='knock-1')queue.push(mutation({id:'knock-2'}));},remove:async(id:string)=>{queue=queue.filter(m=>m.id!==id);},block:async()=>{},active:()=>true};
  await syncOutbox(deps);assert.deepEqual(sent,['knock-1','knock-2']);assert.equal(queue.length,0);
  queue=[mutation()];await syncOutbox({...deps,send:async()=>{throw Object.assign(Error('Offline'),{status:503});}});assert.equal(queue.length,1);
});
const config: FieldConfig = {
  ...DEFAULT_FIELD_CONFIG,
  version: "test",
  pilotPercent: 100,
  enabled: Object.fromEntries(
    FEATURE_KEYS.map((k) => [k, true]),
  ) as FieldConfig["enabled"],
  publicOrigin: "https://example.com",
};
const door = (patch: Partial<Lead> = {}): Lead => ({
  id: "door",
  name: "Example",
  address: "10 Test Street",
  city: "Example",
  state: "AZ",
  zip: "85001",
  status: "unclaimed",
  assignedTo: "rep",
  createdAt: new Date("2026-01-01"),
  lat: 33,
  lng: -112,
  ...patch,
});
const observation = (
  patch: Partial<FieldObservation> = {},
): FieldObservation => ({
  eventId: "knock-1",
  timeZone: "America/Phoenix",
  localHour: 0,
  localDay: 0,
  statusId: "not-home",
  countsAsKnock: true,
  flags: config.enabled,
  experiment: config.experiment,
  group: "pilot",
  answered: false,
  gps: { lat: 33, lng: -112, accuracy: 5, timestamp: now.toISOString() },
  ...patch,
});
const mutation = (patch: Partial<FieldMutation> = {}): FieldMutation => ({
  id: "knock-1",
  userId: "rep",
  leadId: "door",
  createdAt: now.toISOString(),
  kind: "knock",
  baseStatus: "unclaimed",
  status: "not-home",
  observation: observation(),
  ...patch,
});
function fixture() {
  const f = fakeAdmin();
  f.seed("users/rep", { role: "setter", name: "Rep", team: "A" });
  f.seed("users/admin", { role: "admin", name: "Admin" });
  f.seed("users/manager", { role: "manager", name: "Manager", team: "A" });
  f.seed("users/other", { role: "setter", name: "Other", team: "B" });
  f.seed("leads/door", {
    ...door(),
    notes: "Original",
    dispositionHistory: [
      {
        disposition: "Imported",
        timestamp: new Date("2026-01-01"),
        userId: "u",
        userName: "Original",
      },
    ],
  });
  f.seed("field_settings/v11", config);
  const deps = {
    adminAuth: () => f.auth,
    adminDb: () => f.db,
    now: () => now,
  } as unknown as Parameters<typeof createFieldHandlers>[0];
  const h = createFieldHandlers(deps),
    settings = createFieldConfigHandlers(deps);
  async function send(body?: unknown, uid = "rep", handler = h) {
    const req = new NextRequest("https://example.com/api/field-work", {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${uid}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const res = await (body ? handler.POST(req) : handler.GET(req));
    return { status: res.status, body: await res.json() };
  }
  return { ...f, send, settings, deps };
}
test("device local hours handle Arizona/New York and DST without server timezone", () => {
  assert.equal(
    localParts(new Date("2026-10-10T18:58Z"), "America/Phoenix").hour,
    11,
  );
  assert.equal(
    localParts(new Date("2026-10-10T18:58Z"), "America/New_York").hour,
    14,
  );
  assert.equal(
    localParts(new Date("2026-11-02T18:58Z"), "America/New_York").hour,
    13,
  );
  assert.equal(
    localParts(new Date("2026-11-02T18:58Z"), "America/Phoenix").hour,
    11,
  );
});
test("pilot allocation is stable and control gets observations without interventions", () => {
  const c = { ...config, pilotPercent: 0 };
  assert.equal(pilotFlags(c, "rep").group, "control");
  assert.equal(pilotFlags(c, "rep").flags.capture, true);
  assert.equal(pilotFlags(c, "rep").flags.timing, false);
  assert.deepEqual(
    pilotFlags({ ...c, pilotPercent: 50 }, "rep"),
    pilotFlags({ ...c, pilotPercent: 50 }, "rep"),
  );
  assert.equal(
    pilotFlags({ ...config, allowedUsers: ["other"] }, "rep").flags.capture,
    false,
  );
});
test("fit excludes DNC, customers and verified nonowners; missing roof stays unknown", () => {
  assert.equal(scoreDoor(door()).known, 0);
  assert.equal(
    scoreDoor(door({ fieldDoor: { doNotKnock: true }, solarCategory: "great" }))
      .excluded,
    true,
  );
  assert.equal(
    scoreDoor(
      door({ fieldDoor: { ownerOccupied: false, ownerVerified: false } }),
    ).excluded,
    false,
  );
  assert.equal(
    scoreDoor(
      door({ fieldDoor: { ownerOccupied: false, ownerVerified: true } }),
    ).excluded,
    true,
  );
  assert.equal(scoreDoor(door({ leadType: "customer" })).excluded, true);
  assert.equal(
    scoreDoor(
      door({
        solarCategory: "great",
        hasSouthFacingRoof: true,
        solarMaxPanels: 20,
        fieldDoor: { ownerOccupied: true, ownerVerified: true },
      }),
    ).score,
    100,
  );
});
test("legacy knock counts remain usable; unknown answers are never invented", () => {
  const l = door({
    dispositionHistory: [
      {
        disposition: "Not Home",
        timestamp: now,
        userId: "rep",
        userName: "Rep",
      },
      {
        disposition: "Not Home",
        timestamp: now,
        userId: "rep",
        userName: "Rep",
      },
    ],
  });
  const es = fieldEvents([l], DEFAULT_DISPOSITIONS, "America/Phoenix");
  assert.equal(es.length, 1);
  assert.equal(funnel(es, [l], now).knocks, 1);
  assert.equal(funnel(es, [l], now).contactKnown, 0);
});
test("returns need spacing, a new time window and an eligible status; unknown timing is explicit", () => {
  const l = door({
    status: "not-home",
    dispositionHistory: [
      {
        disposition: "Not Home",
        timestamp: new Date("2026-10-08T17:00Z"),
        userId: "rep",
        userName: "Rep",
        field: observation({ eventId: "old" }),
      },
    ],
  });
  const es = fieldEvents([l], DEFAULT_DISPOSITIONS, "America/Phoenix");
  const user = { id: "rep", role: "setter" as const };
  const returns = revisitDoors([l], es, config, user, now, "America/Phoenix");
  assert.equal(returns.length, 1);
  assert.match(returns[0].reason, /not enough/);
  assert.equal(
    revisitDoors(
      [{ ...l, status: "go-back" }],
      es,
      config,
      user,
      now,
      "America/Phoenix",
    ).length,
    0,
  );
  assert.equal(
    revisitDoors(
      [{ ...l, fieldDoor: { doNotKnock: true } }],
      es,
      config,
      user,
      now,
      "America/Phoenix",
    ).length,
    0,
  );
  assert.equal(
    revisitDoors(
      [l],
      es,
      { ...config, maxAttempts: 1 },
      user,
      now,
      "America/Phoenix",
    ).length,
    0,
  );
  assert.ok(
    contactWindows(l, es, config, now, "America/Phoenix").every(
      (w) => w.confidence === "insufficient",
    ),
  );
});
test("savings refuse missing assumptions and cap credits without fabricating a price", () => {
  assert.equal(
    savingsPreview(door({ estimatedBill: 200, solarMaxPanels: 30 }), null),
    null,
  );
  assert.equal(
    cleanConfig({ savings: { approved: true } as any }).savings,
    null,
  );
  const a = cleanConfig({
    savings: {
      approved: true,
      approvedAt: new Date().toISOString(),
      source: "Fixture only",
      state: "AZ",
      panelWatts: 400,
      annualKwhPerKwLow: 1400,
      annualKwhPerKwHigh: 1600,
      avoidedRateLow: 0.1,
      avoidedRateHigh: 0.15,
      monthlyPaymentPerKwLow: 20,
      monthlyPaymentPerKwHigh: 25,
      fixedMonthlyCharge: 20,
      selfConsumption: 0.5,
      exportRate: 0.1,
    },
  }).savings;
  const p = savingsPreview(
    door({ estimatedBill: 200, solarMaxPanels: 100 }),
    a,
  )!;
  assert.ok(p.savings[1] <= 180 - p.payments[0]);
  assert.equal(
    savingsPreview(
      door({ state: "NY", estimatedBill: 200, solarMaxPanels: 20 }),
      a,
    ),
    null,
  );
});
test("server appends once, computes local time, preserves pin identity and old history", async () => {
  const f = fixture(),
    before = structuredClone(f.records.get("leads/door")!.value);
  assert.equal((await f.send(mutation())).status, 200);
  assert.equal((await f.send(mutation())).body.replayed, true);
  const l = f.records.get("leads/door")!.value;
  assert.equal(l.dispositionHistory.length, 2);
  assert.deepEqual(l.dispositionHistory[1], before.dispositionHistory[0]);
  assert.equal(l.assignedTo, "rep");
  assert.equal(l.notes, "Original");
  assert.equal(l.dispositionHistory[0].field.localHour, 14);
  assert.equal(l.dispositionHistory[0].field.localDay, 6);
  assert.equal(f.writes.length, 1);
});
test("conflicts and reassignment retain server data; spoofed proximity and authority fail", async () => {
  const f = fixture();
  assert.equal(
    (await f.send(mutation({ baseStatus: "interested" }))).status,
    409,
  );
  assert.equal(
    (
      await f.send(
        mutation({
          observation: observation({
            gps: {
              lat: 34,
              lng: -112,
              accuracy: 5,
              timestamp: now.toISOString(),
            },
          }),
        }),
      )
    ).status,
    409,
  );
  assert.equal((await f.send(mutation(), "other")).status, 400);
  assert.equal(
    (await f.send(mutation({ userId: "other" }), "other")).status,
    403,
  );
  f.seed("users/rep", { role: "setter", deleted: true });
  assert.equal((await f.send(mutation())).status, 403);
  assert.equal(f.writes.length, 0);
});
test("notes merge only against matching base and replay does not create extra writes", async () => {
  const f = fixture(),
    m = mutation({
      kind: "notes",
      baseNotes: "Original",
      notes: "Original\nDictated note",
    });
  assert.equal((await f.send(m)).status, 200);
  assert.equal((await f.send(m)).body.replayed, true);
  assert.equal(
    (await f.send({ ...m, id: "notes-two", notes: "Overwrite" })).status,
    409,
  );
  assert.equal(f.records.get("leads/door")!.value.status, "unclaimed");
  assert.equal(f.writes.length, 1);
});
test("paused flags block queued work and only same-team managers can acknowledge handoffs", async () => {
  const f = fixture();
  f.seed("field_settings/v11", {
    ...config,
    enabled: { ...config.enabled, capture: false },
  });
  assert.equal((await f.send(mutation())).status, 409);
  f.seed("field_settings/v11", config);
  assert.equal(
    (await f.send(mutation({ kind: "handoff", handoff: "acknowledged" })))
      .status,
    403,
  );
  assert.equal(
    (await f.send(mutation({ kind: "handoff", handoff: "booked" }))).status,
    400,
  );
  assert.equal(
    (
      await f.send(
        mutation({
          kind: "handoff",
          userId: "manager",
          handoff: "acknowledged",
        }),
        "manager",
      )
    ).status,
    200,
  );
});
test("settings require active admin and an exact version", async () => {
  const f = fixture();
  assert.equal(
    (await f.send({ version: "test", config }, "rep", f.settings)).status,
    403,
  );
  assert.equal(
    (await f.send({ version: "stale", config }, "admin", f.settings)).status,
    409,
  );
  const r = await f.send(
    {
      version: "test",
      config: { ...config, secret: "never return", proof: [] },
    },
    "admin",
    f.settings,
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.config.secret, undefined);
  assert.notEqual(r.body.config.version, "test");
});
test("offline overlays do not mutate source, duplicate accepted events, or apply dependent conflicts", () => {
  const l = door();
  const m = mutation({ disposition: "Not Home" });
  const output = overlayDrafts([l], [m]);
  assert.equal(l.status, "unclaimed");
  assert.equal(output[0].status, "not-home");
  assert.equal(overlayDrafts(output, [m])[0].dispositionHistory?.length, 1);
  assert.equal(
    overlayDrafts(
      [l],
      [
        { ...m, blocked: true },
        { ...m, id: "second", kind: "notes", notes: "dependent" },
      ],
    )[0].notes,
    undefined,
  );
});
test("public tickets are encrypted, expire and reject tampering before database access", () => {
  const secret = "a".repeat(40),
    ticket = {
      leadId: "private-door",
      setterId: "rep",
      expires: now.getTime() + 60000,
      name: "Rep",
      city: "Example",
      state: "AZ",
    },
    code = sealTicket(ticket, secret);
  assert.ok(!code.includes("private-door"));
  assert.deepEqual(openTicket(code, secret, now.getTime()), ticket);
  assert.throws(() =>
    openTicket(code.slice(0, -2) + "AA", secret, now.getTime()),
  );
  assert.throws(() => openTicket(code, secret, now.getTime() + 120000));
});
test("recovery callback stores consent/attribution without editing phone, outcomes or sending messages", async () => {
  const f = fixture(),
    secret = "b".repeat(40);
  f.seed("leads/door", { ...door({ status: "not-home" }), phone: "original" });
  const h = createRecoveryHandlers({
    ...f.deps,
    secret: () => secret,
    enabled: () => true,
    now: () => now.getTime(),
  });
  const call = async (body: any, origin = "https://example.com") => {
    const r = await h.POST(
      new NextRequest("https://example.com/api/field-recovery", {
        method: "POST",
        headers: {
          Authorization: "Bearer rep",
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
    return { status: r.status, body: await r.json() };
  };
  const issued = await call({ action: "issue", leadId: "door" });
  assert.equal(issued.status, 200);
  const code = new URL(issued.body.url).searchParams.get("code");
  assert.equal(
    (
      await call({
        action: "callback",
        code,
        name: "Fixture",
        phone: "5555550100",
        consent: false,
      })
    ).status,
    400,
  );
  const body = {
    action: "callback",
    code,
    name: "Fixture",
    phone: "5555550100",
    consent: true,
  };
  assert.equal((await call(body, "https://evil.example")).status, 403);
  assert.equal((await call(body)).status, 200);
  assert.equal((await call(body)).body.alreadyRequested, true);
  const l = f.records.get("leads/door")!.value;
  assert.equal(l.phone, "original");
  assert.equal(l.status, "not-home");
  assert.equal(l.fieldRecovery.setterId, "rep");
  assert.equal(l.fieldRecovery.consentVersion, "one-callback-v11");
  assert.equal(f.authCalls.length, 0);
});
