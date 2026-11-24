import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  deliverEmpowerBump,
  EMPOWER_AMBIGUOUS_MESSAGE,
  EMPOWER_SIGN_IN_MESSAGE,
  memoryEmpowerStorage,
  storedEmpowerState,
  type EmpowerOutcome,
} from "../../app/empower/empowerBump";
import type { EmpowerBumpPayload } from "../../app/empower/bumpLogic";

const formSource = readFileSync(new URL("../../app/components/EmpowerBumpForm.tsx", import.meta.url), "utf8");
const dialogSource = readFileSync(new URL("../../app/field/ProximityWarningDialog.tsx", import.meta.url), "utf8");
const detailSource = readFileSync(new URL("../../app/components/LeadDetail.tsx", import.meta.url), "utf8");

function payload(patch: Partial<EmpowerBumpPayload> = {}): EmpowerBumpPayload {
  return {
    draftId: "draft-hang",
    actedAt: "2026-11-24T09:30:00.000Z",
    leadId: "door-1",
    name: "Ada Lovelace",
    phone: "5555550100",
    email: "ada@example.test",
    address: "10 Main St",
    city: "Buffalo",
    state: "NY",
    zip: "14201",
    householdSize: 1,
    estimatedBand: "not_sure",
    assistanceNone: true,
    ...patch,
  };
}

test("the proximity warning sits above the Empower Bump form so Save cannot hang behind it", () => {
  const formZ = formSource.match(/z-\[(\d+)\]/);
  const dialogZ = dialogSource.match(/z-\[(\d+)\]/);
  assert.ok(formZ);
  assert.ok(dialogZ);
  assert.equal(Number(formZ[1]), 120);
  assert.equal(Number(dialogZ[1]), 140);
  assert.ok(Number(dialogZ[1]) > Number(formZ[1]));
  const dialogAt = detailSource.indexOf("{proximity.dialog}");
  const formAt = detailSource.indexOf("<EmpowerBumpForm");
  assert.ok(dialogAt > 0 && formAt > dialogAt);
  assert.match(detailSource, /saveReportingPatch\(knockPatch\([\s\S]*?\), true\)/);
});

test("a hanging office POST times out as ambiguous, keeps the draft id, and is not retried", async () => {
  const storage = memoryEmpowerStorage();
  let posts = 0;
  const outcome = await deliverEmpowerBump(payload({ draftId: "draft-timeout" }), {
    uid: "rep-1",
    storage,
    timeoutMs: 30,
    getToken: async () => "token",
    post: () => {
      posts += 1;
      return new Promise(() => {});
    },
  });
  assert.equal(posts, 1);
  assert.deepEqual(outcome, { status: "ambiguous", message: EMPOWER_AMBIGUOUS_MESSAGE, attempted: true });
  assert.equal(storedEmpowerState("draft-timeout", storage, "rep-1"), "ambiguous");
  const retry = await deliverEmpowerBump(payload({ draftId: "draft-timeout" }), {
    uid: "rep-1",
    storage,
    timeoutMs: 30,
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  assert.equal(posts, 1);
  assert.equal(retry.status, "ambiguous");
  assert.equal(retry.attempted, false);
});

test("a hanging auth token times out before the POST and does not retry the office route", async () => {
  const storage = memoryEmpowerStorage();
  let posts = 0;
  const started = Date.now();
  const outcome = await deliverEmpowerBump(payload({ draftId: "draft-token" }), {
    uid: "rep-1",
    storage,
    tokenTimeoutMs: 30,
    getToken: () => new Promise(() => {}),
    post: async () => {
      posts += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  assert.ok(Date.now() - started < 1000);
  assert.equal(posts, 0);
  assert.deepEqual(outcome, { status: "signin", message: EMPOWER_SIGN_IN_MESSAGE, attempted: false });
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const { window } = dom;
const target = globalThis as unknown as Record<string, unknown>;
const view = window as unknown as Record<string, unknown>;
for (const name of [
  "window",
  "document",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLLabelElement",
  "Element",
  "Node",
  "SVGElement",
  "DocumentFragment",
  "Event",
  "MouseEvent",
  "MutationObserver",
]) {
  target[name] = view[name];
}
target.getComputedStyle = window.getComputedStyle.bind(window);
target.IS_REACT_ACT_ENVIRONMENT = true;

type LoadedForm = {
  act: typeof import("react").act;
  createElement: typeof import("react").createElement;
  createRoot: typeof import("react-dom/client").createRoot;
  EmpowerBumpForm: typeof import("../../app/components/EmpowerBumpForm").default;
};

let loaded: LoadedForm | undefined;

async function loadForm(): Promise<LoadedForm> {
  if (loaded) return loaded;
  const react = await import("react");
  const client = await import("react-dom/client");
  loaded = {
    act: react.act,
    createElement: react.createElement,
    createRoot: client.createRoot,
    EmpowerBumpForm: (await import("../../app/components/EmpowerBumpForm")).default,
  };
  return loaded;
}

async function step(run: () => void | Promise<void>) {
  const { act } = await loadForm();
  await act(run);
}

function lead() {
  return {
    id: "door-1",
    name: "Ada Lovelace",
    phone: "5555550100",
    email: "ada@example.test",
    address: "10 Main St",
    city: "Buffalo",
    state: "NY",
    zip: "14201",
    county: "Erie",
  };
}

async function mountForm(onSubmit: (payload: EmpowerBumpPayload) => Promise<EmpowerOutcome>) {
  const { createElement, createRoot, EmpowerBumpForm } = await loadForm();
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const root = createRoot(host);
  await step(() => {
    root.render(createElement(EmpowerBumpForm, {
      lead: lead(),
      onClose: () => {},
      onSubmit,
    }));
  });
  return {
    root,
    saveButton() {
      const found = [...document.querySelectorAll("button")].find((button) =>
        /Save Empower Bump|Saving/.test(button.textContent || ""));
      assert.ok(found instanceof HTMLButtonElement);
      return found;
    },
    async fillRequired() {
      const size = document.querySelector('select[aria-label="Household members"]');
      assert.ok(size instanceof HTMLSelectElement);
      const none = [...document.querySelectorAll("label")].find((label) => label.textContent?.trim() === "None");
      const confirm = document.getElementById("empower-contact-confirmed");
      assert.ok(none);
      assert.ok(confirm instanceof HTMLInputElement);
      await step(() => {
        size.value = "1";
        size.dispatchEvent(new Event("change", { bubbles: true }));
        none.querySelector("input")?.click();
        confirm.click();
      });
    },
  };
}

test("a validation failure surfaces the error and never leaves Save spinning", async () => {
  let submitted = 0;
  const form = await mountForm(async () => {
    submitted += 1;
    return { status: "sent", attempted: true };
  });
  await step(() => {
    form.saveButton().click();
  });
  assert.equal(submitted, 0);
  assert.match(document.body.textContent || "", /Fix these before saving/);
  assert.equal(form.saveButton().textContent?.trim(), "Save Empower Bump");
  assert.equal(form.saveButton().disabled, false);
});

test("a hanging fetch times out, clears Saving, and keeps the draft from being retried", async () => {
  const storage = memoryEmpowerStorage();
  let posts = 0;
  let draftId = "";
  const form = await mountForm((body) => {
    draftId = body.draftId;
    return deliverEmpowerBump(body, {
      uid: "rep-1",
      storage,
      timeoutMs: 40,
      getToken: async () => "token",
      post: () => {
        posts += 1;
        return new Promise(() => {});
      },
    });
  });
  await form.fillRequired();
  await step(() => {
    form.saveButton().click();
  });
  assert.equal(form.saveButton().textContent?.includes("Saving"), true);
  await new Promise((resolve) => setTimeout(resolve, 80));
  await step(() => {});
  assert.equal(posts, 1);
  assert.equal(form.saveButton().textContent?.trim(), "Save Empower Bump");
  assert.equal(form.saveButton().disabled, false);
  assert.ok(draftId);
  assert.equal(storedEmpowerState(draftId, storage, "rep-1"), "ambiguous");
});

test("a successful bump leaves the Save button idle after the office call returns", async () => {
  let submitted = 0;
  const form = await mountForm(async () => {
    submitted += 1;
    return { status: "sent", attempted: true };
  });
  await form.fillRequired();
  await step(() => {
    form.saveButton().click();
  });
  await step(() => {});
  assert.equal(submitted, 1);
  assert.equal(form.saveButton().textContent?.trim(), "Save Empower Bump");
  assert.equal(form.saveButton().disabled, false);
});
