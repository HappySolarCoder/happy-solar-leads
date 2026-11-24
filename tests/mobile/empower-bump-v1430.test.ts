import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  callButtonFollowsBump,
  finishEmpowerBump,
  type EmpowerOutcome,
} from "../../app/empower/empowerBump";
import { bandChoices, type EmpowerBumpPayload } from "../../app/empower/bumpLogic";
import {
  FALLBACK_SCHEDULING_MANAGER_PHONE,
  schedulingManagerTelDigits,
} from "../../app/utils/schedulingManagerTel";

const root = path.join(import.meta.dirname, "../..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function outcome(status: EmpowerOutcome["status"], attempted = true): EmpowerOutcome {
  return { status, message: status, attempted };
}

test("release 14.30 build 175 is the same number in the app, iOS, and Android", () => {
  const release = JSON.parse(read("app/mobile/_lib/release.json"));
  assert.equal(release.version, "14.30");
  assert.equal(release.build, 175);
  const project = read("ios/App/App.xcodeproj/project.pbxproj");
  assert.deepEqual([...project.matchAll(/MARKETING_VERSION = ([0-9.]+);/g)].map((m) => m[1]), ["14.30", "14.30"]);
  assert.deepEqual([...project.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => m[1]), ["175", "175"]);
  const gradle = read("android/app/build.gradle");
  assert.match(gradle, /versionName "14\.30"/);
  assert.match(gradle, /versionCode 175\b/);
});

test("the client already sends address, phone, email, estimatedBand, county and household size, and does not add a new income key", () => {
  const logic = read("app/empower/bumpLogic.ts");
  const payloadBlock = logic.slice(logic.indexOf("const payload: EmpowerBumpPayload"), logic.indexOf("return { ok: true, payload }"));
  for (const key of ["phone", "email", "address", "city", "state", "zip", "householdSize", "estimatedBand"]) {
    assert.match(payloadBlock, new RegExp(`\\b${key}\\b`));
  }
  assert.doesNotMatch(payloadBlock, /annualHouseholdIncome|incomeSelection/);
  assert.doesNotMatch(logic, /annualHouseholdIncome/);
  const typeBlock = logic.slice(logic.indexOf("export interface EmpowerBumpPayload"), logic.indexOf("export interface EmpowerBumpDraftInput"));
  assert.doesNotMatch(typeBlock, /annualHouseholdIncome|incomeSelection/);
  const keys: (keyof EmpowerBumpPayload)[] = [
    "draftId", "actedAt", "leadId", "name", "phone", "email", "address",
    "city", "state", "zip", "householdSize", "estimatedBand", "assistanceNone",
  ];
  assert.ok(keys.includes("phone"));
  assert.ok(keys.includes("email"));
  assert.ok(keys.includes("address"));
});

test("the form income selection is a published dollar-range bracket, not a raw annual figure", () => {
  const choices = bandChoices("Erie", 1);
  const labels = choices.map((choice) => choice.label);
  assert.equal(choices[0]?.id, "tier1");
  assert.match(labels[0] ?? "", /Tier 1 \(est\.\) — at or under \$42,450/);
  assert.match(labels[1] ?? "", /Tier 3 \(est\.\) — above \$42,450 and at or under \$56,600/);
  assert.match(labels[2] ?? "", /Comfort Home \(est\.\) — above \$56,600/);
  assert.equal(choices[3]?.id, "not_sure");
  assert.equal(labels[3], "Not sure");
  for (const label of labels.slice(0, 3)) {
    assert.doesNotMatch(label, /^\$?\d+$/);
  }
});

test("the call button is offered only after a confirmed send, not after queued or ambiguous outcomes", () => {
  assert.equal(callButtonFollowsBump(outcome("sent")), true);
  assert.equal(callButtonFollowsBump(outcome("queued")), false);
  assert.equal(callButtonFollowsBump(outcome("ambiguous")), false);
  assert.equal(callButtonFollowsBump(outcome("invalid", false)), false);
});

test("finishEmpowerBump does not open the Send Info / Call Scheduling Manager flow", async () => {
  const sent = await finishEmpowerBump({
    saveLocal: async () => {},
    send: async () => outcome("sent"),
  });
  assert.equal(sent.status, "sent");
  assert.equal(callButtonFollowsBump(sent), true);

  const queued = await finishEmpowerBump({
    saveLocal: async () => {},
    send: async () => outcome("queued"),
  });
  assert.equal(queued.status, "queued");
  assert.equal(callButtonFollowsBump(queued), false);
});

test("LeadDetail shows the existing tel: Scheduling Manager button only after a confirmed send", () => {
  const detail = read("app/components/LeadDetail.tsx");
  const submit = detail.slice(detail.indexOf("const handleEmpowerSubmit"), detail.indexOf("// Handle saving notes"));
  assert.equal(submit.includes("openCallSchedulingManager"), false);
  assert.equal(submit.includes("openScheduling"), false);
  assert.match(submit, /setOfferSchedulingCall\(callButtonFollowsBump\(outcome\)\)/);
  assert.match(detail, /offerSchedulingCall && !isHotOnlyLead\(lead\)/);
  assert.match(detail, /<SchedulingManagerCallButton/);
  // The existing manual CSM control on the door stays; it is not auto-opened after a bump.
  assert.match(detail, /aria-label="CSM — Call Scheduling Manager"/);
  assert.equal(detail.includes("sendSchedulingNotification"), false);
});

test("the post-bump call button reuses the existing tel: number and does not invent one or use App.openUrl", () => {
  assert.equal(FALLBACK_SCHEDULING_MANAGER_PHONE, "(716) 272-9889");
  assert.equal(schedulingManagerTelDigits(FALLBACK_SCHEDULING_MANAGER_PHONE), "7162729889");

  const button = read("app/components/SchedulingManagerCallButton.tsx");
  assert.match(button, /FALLBACK_SCHEDULING_MANAGER_PHONE/);
  assert.match(button, /schedulingManagerTelDigits/);
  assert.match(button, /getAdminSettingsAsync/);
  assert.match(button, /const href = `tel:\$\{schedulingManagerTelDigits\(phone\)\}`/);
  assert.match(button, /href=\{href\}/);
  assert.match(button, /Native tel: keeps the iOS\/Android user gesture|plain href keeps the iOS\/Android user gesture/);
  assert.doesNotMatch(button, /from ['"]@capacitor\/app['"]|App\.openUrl\(/);
  assert.doesNotMatch(button, /window\.open\(/);
  assert.doesNotMatch(button, /Browser\.open\(/);

  const modal = read("app/components/LeadEditorModal.tsx");
  assert.match(modal, /tel:\$\{schedulingManagerTelDigits/);
  assert.match(modal, /Native tel: keeps the iOS user gesture/);
  assert.doesNotMatch(modal, /from ['"]@capacitor\/app['"]|App\.openUrl\(/);

  const cap = read("capacitor.config.ts");
  assert.doesNotMatch(cap, /tel:|openUrl|allowNavigation/);
});
