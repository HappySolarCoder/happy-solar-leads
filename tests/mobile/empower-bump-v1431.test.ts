import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import {
  callButtonFollowsBump,
  deliverEmpowerBump,
  EMPOWER_AMBIGUOUS_MESSAGE,
  EMPOWER_OFFLINE_MESSAGE,
  EMPOWER_QUEUED_MESSAGE,
  EMPOWER_RATE_MESSAGE,
  EMPOWER_SIGN_IN_MESSAGE,
  formClosesAfterBump,
  memoryEmpowerStorage,
  storedEmpowerState,
  type EmpowerOutcome,
} from "../../app/empower/empowerBump";
import type { EmpowerBumpPayload } from "../../app/empower/bumpLogic";

const root = path.join(import.meta.dirname, "../..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function payload(patch: Partial<EmpowerBumpPayload> = {}): EmpowerBumpPayload {
  return {
    draftId: "draft-1431",
    actedAt: "2026-11-24T10:50:00.000Z",
    leadId: "door-1",
    name: "Ada Lovelace",
    phone: "5555550100",
    email: "ada@example.test",
    address: "10 Main St",
    city: "Buffalo",
    state: "NY",
    zip: "14201",
    county: "Erie",
    householdSize: 1,
    estimatedBand: "tier3",
    assistanceNone: true,
    ...patch,
  };
}

test("release 14.31 build 176 is the same number in the app, iOS, and Android", () => {
  const release = JSON.parse(read("app/mobile/_lib/release.json"));
  assert.equal(release.version, "14.31");
  assert.equal(release.build, 176);
  const project = read("ios/App/App.xcodeproj/project.pbxproj");
  assert.deepEqual([...project.matchAll(/MARKETING_VERSION = ([0-9.]+);/g)].map((m) => m[1]), ["14.31", "14.31"]);
  assert.deepEqual([...project.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => m[1]), ["176", "176"]);
  const gradle = read("android/app/build.gradle");
  assert.match(gradle, /versionName "14\.31"/);
  assert.match(gradle, /versionCode 176\b/);
});

test("the form closes only when the office call was attempted, and also after a queued sign-in draft", () => {
  const sent: EmpowerOutcome = { status: "sent", attempted: true };
  const queued: EmpowerOutcome = { status: "queued", message: EMPOWER_QUEUED_MESSAGE, attempted: true };
  const rate: EmpowerOutcome = { status: "queued", message: EMPOWER_RATE_MESSAGE, attempted: true };
  const offline: EmpowerOutcome = { status: "queued", message: EMPOWER_OFFLINE_MESSAGE, attempted: false };
  const ambiguous: EmpowerOutcome = { status: "ambiguous", message: EMPOWER_AMBIGUOUS_MESSAGE, attempted: true };
  const rejected: EmpowerOutcome = { status: "invalid", message: "Invalid ZIP code.", attempted: false };
  const conflict: EmpowerOutcome = { status: "invalid", message: "This draft is already in flight.", attempted: false, conflict: true };
  const tokenHang: EmpowerOutcome = { status: "signin", message: EMPOWER_SIGN_IN_MESSAGE, attempted: false };
  const after401: EmpowerOutcome = { status: "signin", message: EMPOWER_SIGN_IN_MESSAGE, attempted: true };

  assert.equal(formClosesAfterBump(sent), true);
  assert.equal(callButtonFollowsBump(sent), true);

  assert.equal(formClosesAfterBump(queued), true);
  assert.equal(callButtonFollowsBump(queued), false);
  assert.equal(formClosesAfterBump(rate), true);
  assert.equal(callButtonFollowsBump(rate), false);

  assert.equal(formClosesAfterBump(offline), false);
  assert.equal(callButtonFollowsBump(offline), false);

  assert.equal(formClosesAfterBump(ambiguous), true);
  assert.equal(callButtonFollowsBump(ambiguous), false);

  assert.equal(formClosesAfterBump(rejected), false);
  assert.equal(callButtonFollowsBump(rejected), false);
  assert.equal(formClosesAfterBump(conflict), false);

  // Queued sign-in drafts keep today's close + door notice; the draft still flushes after auth.
  assert.equal(formClosesAfterBump(tokenHang), true);
  assert.equal(formClosesAfterBump(after401), true);
  assert.equal(callButtonFollowsBump(tokenHang), false);
});

test("a 400 or 409 rejection is terminal, does not close the form, and does not auto-retry", async () => {
  const storage = memoryEmpowerStorage();
  let posts = 0;
  const rejected = await deliverEmpowerBump(payload({ draftId: "draft-400" }), {
    uid: "rep-1",
    storage,
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return jsonResponse(400, { error: "Invalid ZIP code." });
    },
  });
  assert.equal(posts, 1);
  assert.equal(rejected.status, "invalid");
  assert.equal(rejected.attempted, false);
  assert.equal(rejected.status === "invalid" && rejected.conflict, undefined);
  assert.equal(rejected.status === "invalid" && rejected.message, "Invalid ZIP code.");
  assert.equal(formClosesAfterBump(rejected), false);
  assert.equal(storedEmpowerState("draft-400", storage, "rep-1"), "rejected");

  const again = await deliverEmpowerBump(payload({ draftId: "draft-400" }), {
    uid: "rep-1",
    storage,
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return jsonResponse(200);
    },
  });
  assert.equal(posts, 1);
  assert.equal(again.status, "invalid");
  assert.equal(again.attempted, false);
  assert.equal(again.status === "invalid" && again.message, "Invalid ZIP code.");

  const conflictStore = memoryEmpowerStorage();
  let conflictPosts = 0;
  const conflict = await deliverEmpowerBump(payload({ draftId: "draft-409" }), {
    uid: "rep-1",
    storage: conflictStore,
    getToken: async () => "token",
    post: async () => {
      conflictPosts += 1;
      return jsonResponse(409, { error: "This draft is already in flight." });
    },
  });
  assert.equal(conflict.status, "invalid");
  assert.equal(conflict.attempted, false);
  assert.equal(conflict.status === "invalid" && conflict.conflict, true);
  assert.equal(formClosesAfterBump(conflict), false);
  assert.equal(storedEmpowerState("draft-409", conflictStore, "rep-1"), "rejected");
  await deliverEmpowerBump(payload({ draftId: "draft-409" }), {
    uid: "rep-1",
    storage: conflictStore,
    getToken: async () => "token",
    post: async () => {
      conflictPosts += 1;
      return jsonResponse(200);
    },
  });
  assert.equal(conflictPosts, 1);
});

test("queued 404/503/429 and an ambiguous timeout still close the form; a token timeout is a queued sign-in and also closes", async () => {
  for (const status of [404, 503] as const) {
    const outcome = await deliverEmpowerBump(payload({ draftId: `draft-${status}` }), {
      uid: "rep-1",
      storage: memoryEmpowerStorage(),
      getToken: async () => "token",
      post: async () => jsonResponse(status, { error: "not enabled" }),
    });
    assert.equal(outcome.status, "queued");
    assert.equal(outcome.attempted, true);
    assert.equal(formClosesAfterBump(outcome), true);
    assert.equal(callButtonFollowsBump(outcome), false);
  }

  const rate = await deliverEmpowerBump(payload({ draftId: "draft-429" }), {
    uid: "rep-1",
    storage: memoryEmpowerStorage(),
    getToken: async () => "token",
    post: async () => new Response("{}", { status: 429, headers: { "retry-after": "30" } }),
  });
  assert.equal(rate.status, "queued");
  assert.equal(rate.attempted, true);
  assert.equal(formClosesAfterBump(rate), true);

  const timedOut = await deliverEmpowerBump(payload({ draftId: "draft-timeout" }), {
    uid: "rep-1",
    storage: memoryEmpowerStorage(),
    timeoutMs: 20,
    getToken: async () => "token",
    post: () => new Promise(() => {}),
  });
  assert.equal(timedOut.status, "ambiguous");
  assert.equal(timedOut.attempted, true);
  assert.equal(formClosesAfterBump(timedOut), true);
  assert.equal(callButtonFollowsBump(timedOut), false);

  const tokenStore = memoryEmpowerStorage();
  const tokenHang = await deliverEmpowerBump(payload({ draftId: "draft-token" }), {
    uid: "rep-1",
    storage: tokenStore,
    tokenTimeoutMs: 20,
    getToken: () => new Promise(() => {}),
    post: async () => {
      throw new Error("should not POST");
    },
  });
  assert.equal(tokenHang.status, "signin");
  assert.equal(tokenHang.attempted, false);
  assert.equal(formClosesAfterBump(tokenHang), true);
  assert.equal(storedEmpowerState("draft-token", tokenStore, "rep-1"), "queued");
});

test("LeadDetail closes the bump form only through formClosesAfterBump, and the form shows inline errors when it stays open", () => {
  const detail = read("app/components/LeadDetail.tsx");
  const submit = detail.slice(detail.indexOf("const handleEmpowerSubmit"), detail.indexOf("// Handle saving notes"));
  assert.match(submit, /if \(formClosesAfterBump\(outcome\)\)/);
  assert.match(submit, /setShowEmpowerBump\(false\)/);
  assert.ok(submit.indexOf("formClosesAfterBump") < submit.indexOf("setShowEmpowerBump(false)"));
  assert.equal(submit.includes("setShowEmpowerBump(false)"), true);

  const form = read("app/components/EmpowerBumpForm.tsx");
  assert.match(form, /if \(!mounted\.current \|\| outcome\.attempted\) return;/);
  assert.match(form, /setError\(empowerNotice\(outcome\)\)/);
  assert.match(form, /outcome\.status === "invalid" && !outcome\.conflict/);
  assert.match(form, /draftId\.current = crypto\.randomUUID\(\)/);
});

const target = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const window = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://raydar.local/" }).window;
const view = window as unknown as Record<string, unknown>;
for (const name of [
  "window",
  "document",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLDivElement",
  "DocumentFragment",
  "Event",
  "MouseEvent",
  "MutationObserver",
]) {
  (target as Record<string, unknown>)[name] = view[name];
}
target.IS_REACT_ACT_ENVIRONMENT = true;

async function loadForm() {
  const react = await import("react");
  const client = await import("react-dom/client");
  const EmpowerBumpForm = (await import("../../app/components/EmpowerBumpForm")).default;
  return { act: react.act, createElement: react.createElement, createRoot: client.createRoot, EmpowerBumpForm };
}

test("a 400 rejection keeps the typed fields and shows the server error inline", async () => {
  const { act, createElement, createRoot, EmpowerBumpForm } = await loadForm();
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const root = createRoot(host);
  const drafts: string[] = [];
  await act(() => {
    root.render(createElement(EmpowerBumpForm, {
      lead: {
        id: "door-1",
        name: "Ada Lovelace",
        phone: "5555550100",
        email: "ada@example.test",
        address: "10 Main St",
        city: "Buffalo",
        state: "NY",
        zip: "14201",
        county: "Erie",
      },
      onClose: () => {},
      onSubmit: async (body: EmpowerBumpPayload) => {
        drafts.push(body.draftId);
        return { status: "invalid", message: "Invalid ZIP code.", attempted: false } satisfies EmpowerOutcome;
      },
    }));
  });

  const size = document.querySelector('select[aria-label="Household members"]');
  const none = [...document.querySelectorAll("label")].find((label) => label.textContent?.trim() === "None");
  const confirm = document.getElementById("empower-contact-confirmed");
  const name = document.querySelector('input[aria-label="Name"]') || document.querySelector("#empower-name") || document.querySelector("input[type='text']");
  assert.ok(size instanceof window.HTMLSelectElement);
  assert.ok(none);
  assert.ok(confirm instanceof window.HTMLInputElement);
  await act(() => {
    size.value = "1";
    size.dispatchEvent(new Event("change", { bubbles: true }));
    none.querySelector("input")?.click();
    confirm.click();
  });
  const save = [...document.querySelectorAll("button")].find((button) => /Save Empower Bump/.test(button.textContent || ""));
  assert.ok(save instanceof window.HTMLButtonElement);
  await act(() => {
    save.click();
  });
  assert.equal(drafts.length, 1);
  assert.match(document.body.textContent || "", /Invalid ZIP code/);
  const nameField = document.querySelector('input[aria-label="Name"]');
  const emailField = document.querySelector('input[aria-label="Email"]');
  const phoneField = document.querySelector('input[aria-label="Phone"]');
  assert.ok(nameField instanceof window.HTMLInputElement);
  assert.ok(emailField instanceof window.HTMLInputElement);
  assert.ok(phoneField instanceof window.HTMLInputElement);
  assert.equal(nameField.value, "Ada Lovelace");
  assert.equal(emailField.value, "ada@example.test");
  assert.equal(phoneField.value, "5555550100");
  const dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog);
  assert.equal(save.textContent?.trim(), "Save Empower Bump");
  assert.equal(save.disabled, false);

  await act(() => {
    save.click();
  });
  assert.equal(drafts.length, 2);
  assert.notEqual(drafts[0], drafts[1]);
  await act(() => root.unmount());
});
