import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Lead } from "../../app/types/index.ts";
import type { Disposition } from "../../app/types/disposition.ts";
import { mergeReportingPatch } from "../../app/field/directWrites.ts";
import { followUpCleanupPatch } from "../../app/mobile/_lib/followUps.ts";
import { summarizeActivity } from "../../app/mobile/_lib/metrics.ts";
import { assembleKnockLeads, resetHotKnockSourcesForTests } from "../../app/mobile/_lib/knockSources.ts";
import {
  KNOCK_LEDGER_MAX_ROWS,
  KNOCK_LEDGER_RETENTION_MS,
  knockLedgerDatabaseName,
  readKnockLedger,
  rememberAcknowledgedKnocks,
  resetKnockLedgerForTests,
  restartKnockLedgerSessionForTests,
  syncKnockLedgerAccount,
} from "../../app/mobile/_lib/knockLedger.ts";
import {
  EXCLUDED_KNOCK_KEYS,
  NON_KNOCK_KEYS,
  countKnocks,
  isCountedKnock,
  knockDayKey,
  knockEvents,
  knocksByDay,
  knocksByUser,
  normalizeDispoKey,
  type KnockCountOptions,
} from "../../app/utils/knockCount.ts";
import type { HotLeadPin } from "../../app/hotLeads/model.ts";

const epoch = new Date(0);
function dispo(id: string, name: string, countsAsDoorKnock: boolean): Disposition {
  return {
    id,
    name,
    countsAsDoorKnock,
    color: "#000000",
    icon: "circle",
    order: 0,
    isDefault: true,
    createdAt: epoch,
    updatedAt: epoch,
  };
}

/** Prod-shaped 17-doc list. countsAsDoorKnock false is exactly the four ownership/exclusion ids. */
const COUNTED: Array<[string, string]> = [
  ["not-home", "Not Home"],
  ["interested", "Interested"],
  ["not-interested", "Not Interested"],
  ["appointment", "Appointment Set"],
  ["call-scheduling-manager", "Call Scheduling Manager"],
  ["sale", "Sale!"],
  ["go-back", "Go Back"],
  ["dq-credit", "DQ Credit"],
  ["house-for-sale", "House for Sale"],
  ["renter", "Renter"],
  ["golden-home", "Golden Home"],
  ["top-10", "Top 10"],
  ["spoke-with-non-homeowner", "Spoke with Non Homeowner "],
];
const NOT_KNOCKS: Array<[string, string]> = [
  ["unclaimed", "Available"],
  ["claimed", "My Targets"],
  ["shade-dq", "Shade DQ"],
  ["has-solar", "Has Solar"],
];
const PROD = [
  ...NOT_KNOCKS.map(([id, name]) => dispo(id, name, false)),
  ...COUNTED.map(([id, name]) => dispo(id, name, true)),
];

const day = (monthDay: number, hour = 15) => new Date(2026, 9, monthDay, hour);
const mon = day(5);
const tue = day(6);

function lead(id: string, patch: Partial<Lead> = {}): Lead {
  return {
    id,
    name: "Example",
    address: "1 Example",
    city: "Example",
    state: "NY",
    zip: "",
    status: "assigned",
    createdAt: day(1),
    ...patch,
  };
}

function visit(
  disposition: string,
  at: Date | string | { seconds: number; nanoseconds?: number } | { toMillis: () => number },
  userId = "u1",
  eventId?: string,
) {
  return {
    disposition,
    timestamp: at as unknown as Date,
    userId,
    userName: "U1",
    ...(eventId
      ? { field: { eventId } as NonNullable<Lead["dispositionHistory"]>[number]["field"] }
      : {}),
  };
}

function knocks(rows: Lead[], opts: KnockCountOptions = {}) {
  return countKnocks(rows, PROD, opts);
}

function hot(patch: Partial<HotLeadPin> = {}): HotLeadPin {
  return {
    id: "ghl_example_pin",
    lat: 43.1,
    lng: -77.6,
    address: "1 Example",
    state: "NY",
    contacts: [{ name: "Example" }],
    hotStatus: "worked",
    claimedBy: "u1",
    claimedByName: null,
    claimedAt: null,
    status: "not-home",
    disposition: "Not Home",
    dispositionedAt: null,
    linkedLeadId: null,
    homeownerId: null,
    ...patch,
  };
}

test("case 1: each counted disposition is +1 and only the exclusion set is zero", () => {
  for (const [id, name] of COUNTED) {
    assert.equal(knocks([lead(id, { dispositionHistory: [visit(id, mon)] })]), 1, id);
    assert.equal(knocks([lead(`${id}-name`, { dispositionHistory: [visit(name, mon)] })]), 1, name);
  }
  for (const [id, name] of NOT_KNOCKS) {
    assert.equal(knocks([lead(id, { dispositionHistory: [visit(id, mon)] })]), 0, id);
    assert.equal(knocks([lead(`${id}-name`, { dispositionHistory: [visit(name, mon)] })]), 0, name);
  }
  assert.equal(knocks([lead("already", { dispositionHistory: [visit("Already Has Solar", mon)] })]), 0);
  for (const status of ["claimed", "unclaimed", "available", "my-targets"]) {
    assert.equal(
      knocks([lead(status, { status, dispositionedAt: mon, claimedBy: "u1" })]),
      0,
      status,
    );
  }
  // Unknown strings count. Only the exclusion set and the unworked set are zero.
  assert.equal(knocks([lead("legacy-unknown", { status: "follow-up-later", dispositionedAt: mon, claimedBy: "u1" })]), 1);
  assert.equal(knocks([lead("legacy-new", { status: "new", dispositionedAt: mon, claimedBy: "u1" })]), 0);
  assert.equal(isCountedKnock("follow-up-later"), true);
  assert.equal(isCountedKnock("new"), false);
  assert.equal(EXCLUDED_KNOCK_KEYS.has("shade-dq"), true);
  assert.equal(NON_KNOCK_KEYS.has("claimed"), true);
});

test("case 2: id, display name, and a trailing space all resolve to the same knock", () => {
  assert.equal(normalizeDispoKey("Not Home", PROD), "not-home");
  assert.equal(normalizeDispoKey("not-home", PROD), "not-home");
  assert.equal(normalizeDispoKey("Spoke with Non Homeowner ", PROD), "spoke-with-non-homeowner");
  for (const raw of ["Not Home", "not-home", "Spoke with Non Homeowner "]) {
    assert.equal(knocks([lead(raw, { dispositionHistory: [visit(raw, mon)] })]), 1, raw);
  }
});

test("case 3: a later non-counted disposition does not remove the earlier knock", () => {
  const shade = lead("shade", {
    status: "shade-dq",
    dispositionedAt: tue,
    dispositionHistory: [visit("Shade DQ", tue), visit("Not Home", mon)],
  });
  const solar = lead("solar", {
    status: "has-solar",
    dispositionedAt: tue,
    dispositionHistory: [visit("Has Solar", tue), visit("Not Interested", mon)],
  });
  assert.equal(knocks([shade], { userId: "u1" }), 1);
  assert.equal(knocks([solar], { userId: "u1" }), 1);
  const start = new Date(2026, 9, 1);
  const end = new Date(2026, 10, 1);
  assert.equal(summarizeActivity([shade, solar], "u1", PROD, start, end).knocks, 2);
});

test("case 4: counted, excluded, counted is two knocks", () => {
  const row = lead("return", {
    status: "go-back",
    dispositionHistory: [visit("Go Back", day(7)), visit("Has Solar", tue), visit("Not Home", mon)],
  });
  assert.equal(knocks([row], { userId: "u1" }), 2);
});

test("case 5: an excluded disposition before a counted one still leaves the counted knock", () => {
  const row = lead("after-shade", {
    status: "not-home",
    dispositionHistory: [visit("Not Home", tue), visit("shade-dq", mon)],
  });
  assert.equal(knocks([row], { userId: "u1" }), 1);
});

test("case 6: claim, unclaim, and unassign do not change the knock", () => {
  const knocked = lead("claimed-door", {
    status: "not-home",
    claimedBy: "u1",
    assignedTo: "u1",
    dispositionHistory: [visit("Not Home", mon)],
  });
  const claimed = { ...knocked, status: "claimed" };
  const unclaimed = { ...knocked, status: "unclaimed", claimedBy: undefined, assignedTo: undefined };
  assert.equal(knocks([knocked]), 1);
  assert.equal(knocks([claimed]), 1);
  assert.equal(knocks([unclaimed]), 1);
});

test("case 7: a later visit adds a knock and leaves the earlier day in place", () => {
  const row = lead("repeat", {
    status: "not-home",
    dispositionedAt: tue,
    dispositionHistory: [visit("Not Home", tue), visit("Not Home", mon)],
  });
  const monday = knocks([row], { userId: "u1", start: new Date(2026, 9, 5), end: new Date(2026, 9, 6) });
  const tuesday = knocks([row], { userId: "u1", start: new Date(2026, 9, 6), end: new Date(2026, 9, 7) });
  const month = knocks([row], { userId: "u1", start: new Date(2026, 9, 1), end: new Date(2026, 10, 1) });
  assert.equal(monday, 1);
  assert.equal(tuesday, 1);
  assert.equal(month, 2);
  const days = knocksByDay([row], PROD, { userId: "u1" });
  assert.equal(days[knockDayKey(mon.getTime())], 1);
  assert.equal(days[knockDayKey(tue.getTime())], 1);
});

test("case 8: each rep keeps their own knock when someone else dispos the pin", () => {
  const row = lead("shared", {
    status: "interested",
    claimedBy: "u2",
    dispositionHistory: [visit("Interested", tue, "u2"), visit("Not Home", mon, "u1")],
  });
  assert.equal(knocks([row], { userId: "u1" }), 1);
  assert.equal(knocks([row], { userId: "u2" }), 1);
  assert.deepEqual(knocksByUser([row], PROD), { u1: 1, u2: 1 });
  const again = { ...row, status: "sale", dispositionHistory: [visit("Sale!", day(8), "u2"), ...row.dispositionHistory!] };
  assert.equal(knocks([again], { userId: "u1" }), 1);
});

test("case 9: replaying a patch does not add a knock, and a late older event stays on its own day", () => {
  const at = day(6);
  const entry = { disposition: "Not Home", timestamp: at, userId: "u1", userName: "U1" };
  const patch = { status: "not-home", dispositionedAt: at, dispositionHistory: [entry] } as Partial<Lead>;
  const once = mergeReportingPatch({}, patch);
  const twice = mergeReportingPatch({ ...once.patch }, patch);
  assert.equal(twice.replayed, true);
  const replayed = lead("replay", { ...once.patch, ...twice.patch });
  assert.equal(replayed.dispositionHistory?.length, 1);
  assert.equal(knocks([replayed], { userId: "u1" }), 1);

  const newerAt = day(6);
  const olderAt = day(5);
  const newer = mergeReportingPatch({}, {
    status: "interested",
    dispositionedAt: newerAt,
    dispositionHistory: [{ disposition: "Interested", timestamp: newerAt, userId: "u1", userName: "U1" }],
  });
  const late = mergeReportingPatch(newer.patch, {
    status: "not-home",
    dispositionedAt: olderAt,
    dispositionHistory: [{ disposition: "Not Home", timestamp: olderAt, userId: "u1", userName: "U1" }],
  });
  const combined = lead("late", { ...newer.patch, ...late.patch });
  assert.equal(combined.status, "interested");
  assert.equal(combined.dispositionHistory?.length, 2);
  assert.equal(knocks([combined], { userId: "u1" }), 2);
  const days = knocksByDay([combined], PROD, { userId: "u1" });
  assert.equal(days[knockDayKey(olderAt.getTime())], 1);
  assert.equal(days[knockDayKey(newerAt.getTime())], 1);
});

test("case 10: full, trimmed, and local snapshots union to one count and a shorter copy cannot lower it", () => {
  const full = lead("door", {
    dispositionHistory: [visit("Go Back", tue), visit("Not Home", mon)],
  });
  const trimmed = lead("door", {
    dispositionHistory: [visit("Go Back", tue)],
  });
  const ack = lead("door", {
    dispositionHistory: [visit("Not Home", mon)],
  });
  assert.equal(knocks([full]), 2);
  assert.equal(knocks([trimmed]), 1);
  assert.equal(knocks([full, trimmed, ack]), 2);
  assert.equal(knocks([trimmed, ack, full]), 2);
  assert.ok(knocks([full, trimmed]) >= knocks([trimmed]));
});

test("case 11: the same event id from two devices counts once", () => {
  const shared = lead("device-a", { dispositionHistory: [visit("Not Home", mon, "u1", "evt-same")] });
  const otherDevice = lead("device-b", { dispositionHistory: [visit("Not Home", mon, "u1", "evt-same")] });
  const different = lead("device-c", { dispositionHistory: [visit("Interested", tue, "u1", "evt-other")] });
  assert.equal(knocks([shared, otherDevice]), 1);
  assert.equal(knocks([shared, different]), 2);
  assert.equal(knockEvents(shared, PROD)[0]?.key, "evt-same");
});

test("case 12: a knock on someone else's pin stays in the device ledger after the lead drops", async () => {
  resetKnockLedgerForTests();
  resetHotKnockSourcesForTests();
  const now = day(20).getTime();
  assert.equal(knockLedgerDatabaseName("u1"), "raydar-knock-ledger:u1");
  const unowned = lead("other-pin", {
    assignedTo: "u2",
    claimedBy: "u2",
    status: "not-home",
    dispositionHistory: [visit("Not Home", day(20), "u1"), visit("Interested", day(20), "u2")],
  });
  await rememberAcknowledgedKnocks("u1", unowned, now);
  const ledger = await readKnockLedger("u1", PROD, now);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0]?.userId, "u1");
  // The 15-minute personal refresh no longer has this pin.
  assert.equal(knocks([], { userId: "u1", ledger, start: new Date(2026, 9, 1), end: new Date(2026, 10, 1) }), 1);
  assert.equal(summarizeActivity([], "u1", PROD, new Date(2026, 9, 1), new Date(2026, 10, 1), { ledger }).knocks, 1);

  const aged = lead("aged", { dispositionHistory: [visit("Not Home", new Date(now - KNOCK_LEDGER_RETENTION_MS - 86_400_000))] });
  const edge = lead("edge", { dispositionHistory: [visit("Go Back", new Date(now - KNOCK_LEDGER_RETENTION_MS))] });
  await rememberAcknowledgedKnocks("u1", aged, now);
  await rememberAcknowledgedKnocks("u1", edge, now);
  const kept = await readKnockLedger("u1", PROD, now);
  assert.equal(kept.some((event) => event.leadId === "aged"), false);
  assert.equal(kept.some((event) => event.leadId === "edge"), true);

  await rememberAcknowledgedKnocks("u1", lead("shade", { dispositionHistory: [visit("Shade DQ", day(20))] }), now);
  assert.equal((await readKnockLedger("u1", PROD, now)).some((event) => event.dispositionId === "shade-dq"), false);

  await syncKnockLedgerAccount("u1");
  await syncKnockLedgerAccount(null);
  assert.ok((await readKnockLedger("u1", PROD, now)).length >= 1);
  await syncKnockLedgerAccount("u2");
  assert.equal((await readKnockLedger("u1", PROD, now)).length, 0);
  assert.equal((await readKnockLedger("u2", PROD, now)).length, 0);
});

test("case 13: hot-lead history counts only while the flag is on, and promotion dedupes when it can", () => {
  resetHotKnockSourcesForTests();
  const at = mon;
  const history = [{ disposition: "Not Home", timestamp: at.toISOString(), userId: "u1", userName: "U1" }];
  const promoted = lead("lead-a", { dispositionHistory: [visit("Not Home", at)] });
  const linked = hot({ id: "ghl_linked", linkedLeadId: "lead-a", dispositionHistory: history });
  const on = assembleKnockLeads({ leads: [promoted], hotPins: [linked], enabled: true });
  assert.equal(knocks(on.leads, { userId: "u1", leadAliases: on.aliases }), 1);
  const off = assembleKnockLeads({ leads: [promoted], hotPins: [linked], enabled: false });
  assert.equal(off.aliases.length, 0);
  assert.equal(knocks(off.leads, { userId: "u1", leadAliases: off.aliases }), 1);
  assert.equal(knocks(assembleKnockLeads({ leads: [], hotPins: [linked], enabled: false }).leads), 0);
  assert.equal(knocks(assembleKnockLeads({ leads: [], hotPins: [linked], enabled: true }).leads, { userId: "u1" }), 1);

  const shared = "evt-promoted";
  const carried = hot({
    id: "ghl_carried",
    linkedLeadId: null,
    dispositionHistory: [{ disposition: "Not Home", timestamp: at.toISOString(), userId: "u1", userName: "U1", field: { eventId: shared } }],
  });
  const moved = lead("promoted-id", { dispositionHistory: [visit("Not Home", at, "u1", shared)] });
  const carriedSet = assembleKnockLeads({ leads: [moved], hotPins: [carried], enabled: true });
  assert.equal(knocks(carriedSet.leads, { userId: "u1", leadAliases: carriedSet.aliases }), 1);

  // No eventId and no linkedLeadId: the hot pin and the new lead id are different doors.
  const fresh = hot({ id: "ghl_fresh", linkedLeadId: null, dispositionHistory: history });
  const separate = assembleKnockLeads({ leads: [promoted], hotPins: [fresh], enabled: true });
  assert.equal(separate.aliases.length, 0);
  assert.equal(knocks(separate.leads, { userId: "u1", leadAliases: separate.aliases }), 2);
});

test("case 14: notes and a schedule change without a new history entry do not add a knock", () => {
  const scheduled = lead("go-back", {
    status: "go-back",
    goBackScheduledBy: "u1",
    goBackScheduledDate: day(9),
    goBackScheduledTime: "2:00 PM",
    dispositionHistory: [visit("Go Back", mon)],
  });
  const noted = { ...scheduled, notes: "Left a card" };
  assert.equal(knocks([scheduled]), 1);
  assert.equal(knocks([noted]), 1);
  const patch = followUpCleanupPatch(scheduled, scheduled, "u1");
  assert.deepEqual(patch, { goBackScheduledDate: null, goBackScheduledTime: "" });
  const cleared = { ...scheduled, ...patch };
  assert.equal(knocks([cleared]), 1);
  const detail = readFileSync(new URL("../../app/components/LeadDetail.tsx", import.meta.url), "utf8");
  assert.match(detail, /saveReportingPatch\(\{ notes \}\)/);
  assert.match(detail, /recordField\('notes', \{ notes \}\)/);
});

test("case 15: a legacy lead with no history uses status and dispositionedAt", () => {
  const knocked = lead("legacy", { status: "not-home", dispositionedAt: mon, claimedBy: "u1" });
  const solar = lead("legacy-solar", { status: "has-solar", dispositionedAt: mon, assignedTo: "u1" });
  const named = lead("legacy-name", { status: "", disposition: "Not Home", dispositionedAt: mon, assignedTo: "u1" });
  assert.equal(knocks([knocked]), 1);
  assert.equal(knocks([solar]), 0);
  assert.equal(knocks([named]), 1);
  assert.equal(knockEvents(knocked, PROD)[0]?.userId, "u1");
});

test("case 16: timestamp shapes parse and invalid ones are skipped", () => {
  const rows = [
    lead("date", { dispositionHistory: [visit("Not Home", mon)] }),
    lead("iso", { dispositionHistory: [visit("Not Home", "2026-10-08T15:00:00.000Z")] }),
    lead("millis", {
      dispositionHistory: [{
        disposition: "Not Home",
        timestamp: { toMillis: () => 1_700_000_000_000 } as unknown as Date,
        userId: "u1",
        userName: "U1",
      }],
    }),
    lead("to-date", {
      dispositionHistory: [{
        disposition: "Interested",
        timestamp: { toDate: () => tue } as unknown as Date,
        userId: "u1",
        userName: "U1",
      }],
    }),
    lead("seconds", {
      dispositionHistory: [visit("Go Back", { seconds: 1_700_000_000, nanoseconds: 250_000_000 })],
    }),
    lead("underscore", {
      dispositionHistory: [{
        disposition: "Renter",
        timestamp: { _seconds: 1_700_000_100, _nanoseconds: 0 } as unknown as Date,
        userId: "u1",
        userName: "U1",
      }],
    }),
    lead("invalid", {
      status: "not-home",
      dispositionedAt: mon,
      claimedBy: "u1",
      dispositionHistory: [{
        disposition: "Not Home",
        timestamp: "not-a-time" as unknown as Date,
        userId: "u1",
        userName: "U1",
      }, {
        disposition: "Not Home",
        timestamp: { toMillis() { throw Error("bad stamp"); } } as unknown as Date,
        userId: "u1",
        userName: "U1",
      }],
    }),
    lead("missing-user", {
      dispositionHistory: [{ disposition: "Not Home", timestamp: mon, userId: "", userName: "U1" }],
    }),
  ];
  assert.doesNotThrow(() => knocks(rows));
  assert.equal(knocks(rows), 6);
  assert.equal(knockEvents(rows[4]!, PROD)[0]?.at, 1_700_000_000_250);
  assert.equal(knocks([rows[6]!]), 0);
});

test("a non-object history entry is skipped and the valid entries still count", () => {
  const row = lead("mixed", {
    dispositionHistory: [
      null,
      undefined,
      4,
      "Not Home",
      ["Not Home"],
      visit("Not Home", mon),
      visit("Go Back", tue),
    ] as unknown as Lead["dispositionHistory"],
  });
  assert.doesNotThrow(() => knocks([row]));
  assert.equal(knocks([row], { userId: "u1" }), 2);
  assert.equal(knockEvents(row, PROD).map((event) => event.dispositionId).sort().join(","), "go-back,not-home");
});

test("an account switch after restart wipes the previous ledger, and the row cap drops the oldest", async () => {
  const saved = new Map<string, string>();
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, String(value)); },
      removeItem: (key: string) => { saved.delete(key); },
    },
  });
  try {
    resetKnockLedgerForTests();
    const now = day(20).getTime();
    const kept = lead("stay", {
      status: "not-home",
      dispositionHistory: [visit("Not Home", day(20))],
    });
    await rememberAcknowledgedKnocks("u1", kept, now);
    await syncKnockLedgerAccount("u1");
    await syncKnockLedgerAccount(null);
    restartKnockLedgerSessionForTests();
    assert.equal(saved.get("raydar-knock-ledger-uid"), "u1");
    await syncKnockLedgerAccount("u1");
    assert.equal((await readKnockLedger("u1", PROD, now)).length, 1);
    restartKnockLedgerSessionForTests();
    await syncKnockLedgerAccount("u2");
    assert.equal((await readKnockLedger("u1", PROD, now)).length, 0);

    const history = Array.from({ length: KNOCK_LEDGER_MAX_ROWS + 1 }, (_, index) =>
      visit("Not Home", new Date(now - (KNOCK_LEDGER_MAX_ROWS - index) * 121_000), "u2"),
    );
    const oldest = now - KNOCK_LEDGER_MAX_ROWS * 121_000;
    await rememberAcknowledgedKnocks("u2", lead("capped", {
      dispositionHistory: history as Lead["dispositionHistory"],
    }), now);
    const rows = await readKnockLedger("u2", PROD, now);
    assert.equal(rows.length, KNOCK_LEDGER_MAX_ROWS);
    assert.equal(rows.some((event) => event.at === oldest), false);
    assert.equal(rows.some((event) => event.at === now), true);
  } finally {
    resetKnockLedgerForTests();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previous });
  }
});

test("the same rep and disposition within 2 minutes is one knock, including a ledger copy", () => {
  const start = day(5).getTime();
  const at = (seconds: number) => new Date(start + seconds * 1000);
  const taps = (...seconds: number[]) =>
    lead("door", {
      dispositionHistory: seconds.map((seconds) => visit("Not Home", at(seconds))).reverse() as Lead["dispositionHistory"],
    });
  assert.equal(knocks([taps(0, 5)]), 1);
  assert.equal(knocks([taps(0, 119, 121)]), 2);
  assert.equal(knocks([taps(0, 60, 120, 180)]), 2);
  const switched = lead("switch", {
    dispositionHistory: [visit("Go Back", at(10)), visit("Not Home", at(0))],
  });
  assert.equal(knocks([switched]), 2);
  const reps = lead("reps", {
    dispositionHistory: [visit("Not Home", at(10), "u2"), visit("Not Home", at(0), "u1")],
  });
  assert.equal(knocks([reps]), 2);
  const server = taps(0);
  const ack = knockEvents(server, PROD)[0];
  assert.ok(ack);
  assert.equal(knocks([server], { userId: "u1", ledger: [ack] }), 1);
  const laterAck = { ...ack, at: start + 5_000, key: `${ack.leadId}|${ack.userId}|${ack.dispositionId}|${start + 5_000}` };
  assert.equal(knocks([server], { userId: "u1", ledger: [laterAck] }), 1);
});

test("case 17: the prod fixture's countsAsDoorKnock false set is exactly claimed, unclaimed, shade-dq, and has-solar", () => {
  assert.equal(PROD.length, 17);
  const excluded = PROD.filter((row) => row.countsAsDoorKnock === false).map((row) => row.id).sort();
  assert.deepEqual(excluded, ["claimed", "has-solar", "shade-dq", "unclaimed"]);
  for (const row of PROD) {
    assert.equal(isCountedKnock(row.id), row.countsAsDoorKnock, row.id);
  }
});
