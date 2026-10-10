import test from "node:test";
import assert from "node:assert/strict";
import { getAppointmentOutcome } from "../../app/utils/appointmentOutcome.ts";
import {
  activityActor,
  followUpBucket,
  summarizeActivity,
} from "../../app/mobile/_lib/metrics.ts";
import type { Lead } from "../../app/types/index.ts";
import type { Disposition } from "../../app/types/disposition.ts";

const now = new Date(2026, 9, 8, 12);
const lead: Lead = {
  id: "lead-a",
  name: "Example",
  address: "1 Example St",
  city: "Example",
  state: "NY",
  zip: "",
  status: "appointment",
  claimedBy: "rep-a",
  assignedTo: "rep-a",
  createdAt: now,
  dispositionedAt: now,
};
const dispositions = [
  { id: "appointment", countsAsDoorKnock: true },
  { id: "custom-contact", countsAsDoorKnock: true },
  { id: "unclaimed", countsAsDoorKnock: false },
] as Disposition[];

test("GHL outcome changes the visual result without modifying knock status or assignment", () => {
  const before = { ...lead, appointmentOutcome: "No Show" };
  const next = { ...before, appointmentOutcome: "Closed Won" };
  const original = JSON.stringify(next);
  assert.equal(getAppointmentOutcome(before)?.key, "noshow");
  assert.equal(getAppointmentOutcome(next)?.key, "sold");
  assert.equal(JSON.stringify(next), original);
  assert.equal(next.status, "appointment");
  assert.equal(next.assignedTo, "rep-a");
});

test("missing outcomes and historical territory pins do not acquire an outcome marker", () => {
  assert.equal(getAppointmentOutcome({ appointmentOutcome: "   " }), null);
  assert.equal(getAppointmentOutcome({}), null);
  assert.equal(
    getAppointmentOutcome({
      appointmentOutcome: "Sold",
      historicalTerritoryPin: true,
    }),
    null,
  );
});

test("custom outcome is preserved, rather than inferred as sold or no-show", () => {
  const result = getAppointmentOutcome({
    appointmentOutcome: "No sale - credit review",
  });
  assert.equal(result?.key, "other");
  assert.equal(result?.label, "No sale - credit review");
});

test("today includes midnight and excludes tomorrow; activity belongs to its actor", () => {
  const from = new Date(2026, 9, 8);
  const until = new Date(2026, 9, 9);
  const records = [
    { ...lead, dispositionedAt: from },
    { ...lead, id: "tomorrow", dispositionedAt: until },
    {
      ...lead,
      id: "other-actor",
      dispositionHistory: [
        {
          userId: "rep-b",
          disposition: "Appointment",
          timestamp: now,
          userName: "Other",
        },
      ],
    },
    { ...lead, id: "custom", status: "custom-contact" },
  ];
  const metrics = summarizeActivity(
    records,
    "rep-a",
    dispositions,
    from,
    until,
  );
  assert.equal(metrics.knocks, 2);
  assert.equal(metrics.appointments, 1);
  assert.equal(activityActor(records[2]), "rep-b");
});

test("go-backs use calendar days and invalid dates remain unscheduled", () => {
  assert.equal(
    followUpBucket(
      { ...lead, goBackScheduledDate: new Date(2026, 9, 7, 23, 59) },
      now,
    ),
    "overdue",
  );
  assert.equal(
    followUpBucket(
      { ...lead, goBackScheduledDate: new Date(2026, 9, 8, 0) },
      now,
    ),
    "today",
  );
  assert.equal(
    followUpBucket(
      { ...lead, goBackScheduledDate: new Date(2026, 9, 9, 0) },
      now,
    ),
    "upcoming",
  );
  assert.equal(
    followUpBucket({ ...lead, goBackScheduledDate: new Date("invalid") }, now),
    "unscheduled",
  );
});
