import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCOUNT_DELETED_NOTICE,
  ACCOUNT_DELETION_ADMIN_BLOCKED,
  ACCOUNT_DELETION_CONFIRMATION,
  ACCOUNT_DELETION_EMAIL_NOTICE,
  ACCOUNT_DELETION_MAIL_UNOPENED,
  ACCOUNT_DELETION_MAILBOX,
  ACCOUNT_DELETION_OFFLINE,
  ACCOUNT_DELETION_PATH,
  ACCOUNT_DELETION_SERVER_ERROR,
  ACCOUNT_DELETION_SIGN_IN_AGAIN,
  ACCOUNT_DELETION_UNCONFIRMED,
  afterMailtoHandoff,
  interpretAccountDeletionResponse,
  requestAccountDeletion,
  resolveMailtoHandoff,
  type AccountDeletionDecision,
} from "../../app/mobile/_lib/accountPolicy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function stays(decision: AccountDeletionDecision) {
  assert.notEqual(decision.action, "sign-out");
  if (decision.action === "stay") {
    assert.match(decision.message, /still signed in/i);
    assert.match(decision.message, /nothing was deleted/i);
  }
}

test("a confirmed deletion response signs out with the 30-day notice", () => {
  for (const body of [
    { ok: true, disabled: true },
    { ok: true, disabled: true, repeated: true },
  ]) {
    const decision = interpretAccountDeletionResponse(200, body);
    assert.equal(decision.action, "sign-out");
    if (decision.action !== "sign-out") return;
    assert.equal(decision.notice, ACCOUNT_DELETED_NOTICE);
    assert.match(decision.notice, /deleted and sign-in is disabled/);
    assert.match(decision.notice, /within 30 days/);
    assert.match(decision.notice, /company's lead records/);
    assert.match(decision.notice, /Nothing on this phone was erased/);
  }
});

test("an unconfirmed or ambiguous response never signs out", () => {
  const cases: Array<[number, unknown]> = [
    [200, { ok: true }],
    [200, { ok: true, disabled: false }],
    [200, { ok: false, disabled: true }],
    [200, null],
    [200, "ok"],
    [403, { ok: false, error: "forbidden" }],
    [405, { ok: false, error: "method-not-allowed" }],
    [400, { error: "bad" }],
    [204, null],
    [0, null],
  ];
  for (const [status, body] of cases) {
    const decision = interpretAccountDeletionResponse(status, body);
    stays(decision);
    assert.equal(decision.action, "stay");
    if (decision.action === "stay") assert.equal(decision.retry, false);
    assert.equal(decision.action === "stay" && decision.message, ACCOUNT_DELETION_UNCONFIRMED);
  }
});

test("a missing route falls back to email and does not sign out yet", () => {
  for (const body of [null, { error: "not-found" }, { ok: false }]) {
    const decision = interpretAccountDeletionResponse(404, body);
    assert.equal(decision.action, "email-fallback");
    stays(decision);
  }
});

test("401 asks for a fresh sign-in and keeps the session", () => {
  for (const error of ["Missing credentials", "Sign in again."]) {
    const decision = interpretAccountDeletionResponse(401, { ok: false, error });
    assert.deepEqual(decision, {
      action: "stay",
      message: ACCOUNT_DELETION_SIGN_IN_AGAIN,
      retry: true,
    });
    stays(decision);
  }
});

test("403 explains that admin accounts cannot be deleted in the app", () => {
  const decision = interpretAccountDeletionResponse(403, {
    ok: false,
    error: "admin-accounts-cannot-self-delete",
  });
  assert.deepEqual(decision, {
    action: "stay",
    message: ACCOUNT_DELETION_ADMIN_BLOCKED,
    retry: false,
  });
  assert.match(ACCOUNT_DELETION_ADMIN_BLOCKED, /Admin accounts can't be deleted in the app/);
  stays(decision);
});

test("network errors and server failures stay signed in and can be retried", () => {
  const server = interpretAccountDeletionResponse(500, { ok: false, error: "Internal error" });
  const unavailable = interpretAccountDeletionResponse(503, null);
  const offline = interpretAccountDeletionResponse(0, null, true);
  assert.deepEqual(server, { action: "stay", message: ACCOUNT_DELETION_SERVER_ERROR, retry: true });
  assert.deepEqual(unavailable, { action: "stay", message: ACCOUNT_DELETION_SERVER_ERROR, retry: true });
  assert.deepEqual(offline, { action: "stay", message: ACCOUNT_DELETION_OFFLINE, retry: true });
  for (const decision of [server, unavailable, offline]) stays(decision);
});

test("the deletion request posts a bearer token and no body", async () => {
  const calls: Array<{ path: string; init: { method: string; headers: { Authorization: string }; body?: unknown } }> = [];
  const decision = await requestAccountDeletion("token-1", async (path, init) => {
    calls.push({ path, init });
    return { status: 200, json: async () => ({ ok: true, disabled: true }) };
  });
  assert.equal(decision.action, "sign-out");
  assert.deepEqual(calls, [{
    path: ACCOUNT_DELETION_PATH,
    init: { method: "POST", headers: { Authorization: "Bearer token-1" } },
  }]);
  assert.equal("body" in calls[0].init, false);
});

test("a thrown request and a 404 with an unreadable body stay unambiguous", async () => {
  const offline = await requestAccountDeletion("token-1", async () => {
    throw new Error("offline");
  });
  assert.deepEqual(offline, { action: "stay", message: ACCOUNT_DELETION_OFFLINE, retry: true });
  let calls = 0;
  const missing = await requestAccountDeletion(null, async () => {
    calls += 1;
    return { status: 200, json: async () => ({ ok: true, disabled: true }) };
  });
  assert.equal(calls, 0);
  stays(missing);
  const unread = await requestAccountDeletion("token-1", async () => ({
    status: 404,
    json: async () => {
      throw new Error("html");
    },
  }));
  assert.equal(unread.action, "email-fallback");
  stays(unread);
});

test("mailto fallback signs out only after the handoff is confirmed", async () => {
  const opened = afterMailtoHandoff(true);
  assert.equal(opened.action, "sign-out");
  if (opened.action !== "sign-out") return;
  assert.equal(opened.notice, ACCOUNT_DELETION_EMAIL_NOTICE);
  assert.match(opened.notice, new RegExp(ACCOUNT_DELETION_MAILBOX.replace(".", "\\.")));
  assert.match(opened.notice, /was opened/);
  const missed = afterMailtoHandoff(false);
  stays(missed);
  assert.equal(missed.action, "stay");
  if (missed.action === "stay") {
    assert.equal(missed.retry, false);
    assert.equal(missed.message, ACCOUNT_DELETION_MAIL_UNOPENED);
    assert.match(missed.message, new RegExp(ACCOUNT_DELETION_MAILBOX.replace(".", "\\.")));
    assert.doesNotMatch(missed.message, /was opened/);
  }

  let openedAt = 0;
  let checks = 0;
  const handedOff = await resolveMailtoHandoff({
    open: () => {
      openedAt = checks;
    },
    hidden: () => {
      checks += 1;
      return checks > 2;
    },
    wait: async () => {},
    timeoutMs: 1000,
    pollMs: 1,
  });
  assert.equal(handedOff, true);
  assert.equal(openedAt, 0);

  const alertWithoutMail = await resolveMailtoHandoff({
    open: () => {},
    hidden: () => false,
    wait: async () => {},
    timeoutMs: 0,
  });
  assert.equal(alertWithoutMail, false);
});

test("the screen confirms the outcome before deleting and signs out only from a confirmed result", () => {
  const source = readFileSync(path.join(root, "app/mobile/_components/AccountDeletion.tsx"), "utf8");
  assert.match(source, /ACCOUNT_DELETION_CONFIRMATION/);
  assert.match(ACCOUNT_DELETION_CONFIRMATION, /disables sign-in right away/);
  assert.match(ACCOUNT_DELETION_CONFIRMATION, /within 30 days/);
  assert.match(ACCOUNT_DELETION_CONFIRMATION, /company's lead records/);
  assert.match(ACCOUNT_DELETION_CONFIRMATION, /only after that email opens/);
  assert.match(source, /requestAccountDeletion/);
  assert.match(source, /afterMailtoHandoff/);
  assert.match(source, /visibilityState === "hidden"/);
  assert.match(source, /appStateChange/);
  assert.doesNotMatch(source, /hasFocus\(/);
  const handoff = source.indexOf("await finishSignOut(resolved.notice)");
  const guard = source.lastIndexOf('resolved.action === "sign-out"', handoff);
  assert.ok(handoff > guard && guard > 0);
  assert.equal(source.match(/await signOut\(\)/g)?.length, 1);
  assert.equal(source.match(/finishSignOut\(/g)?.length, 2);
  assert.doesNotMatch(source, /deleteDoc|removeDraft|deleteDatabase|localStorage\.clear|\/api\/admin\/delete-user/);
});
