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
  ACCOUNT_DELETION_EMAIL_NOT_SENT,
  ACCOUNT_DELETION_EMAIL_QUESTION,
  ACCOUNT_DELETION_EMAIL_SIGNOUT_FAILED,
  ACCOUNT_DELETION_LIKELY_DELETED,
  ACCOUNT_DELETION_MAILBOX,
  ACCOUNT_DELETION_OFFLINE,
  ACCOUNT_DELETION_PATH,
  ACCOUNT_DELETION_SERVER_ERROR,
  ACCOUNT_DELETION_SERVER_SIGNOUT_FAILED,
  ACCOUNT_DELETION_SIGN_IN_AGAIN,
  ACCOUNT_DELETION_UNKNOWN_KEY,
  ACCOUNT_DELETION_UNKNOWN_OUTCOME,
  ACCOUNT_DELETION_UNCONFIRMED,
  clearUnknownDeletionAttempt,
  emailHandoffChoice,
  interpretAccountDeletionResponse,
  rememberUnknownDeletionAttempt,
  requestAccountDeletion,
  unknownDeletionAttempt,
  waitUntilAppIsVisible,
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

test("401 with no earlier unknown attempt asks for a fresh sign-in", () => {
  for (const error of ["Missing credentials", "Sign in again."]) {
    const decision = interpretAccountDeletionResponse(401, { ok: false, error }, false, false);
    assert.deepEqual(decision, {
      action: "stay",
      message: ACCOUNT_DELETION_SIGN_IN_AGAIN,
      retry: true,
    });
    stays(decision);
    assert.doesNotMatch(ACCOUNT_DELETION_SIGN_IN_AGAIN, /most likely already deleted/);
  }
});

test("401 after an unknown attempt says the account was most likely deleted", () => {
  for (const error of ["Missing credentials", "Sign in again."]) {
    const decision = interpretAccountDeletionResponse(401, { ok: false, error }, false, true);
    assert.equal(decision.action, "likely-deleted");
    if (decision.action !== "likely-deleted") return;
    assert.equal(decision.notice, ACCOUNT_DELETION_LIKELY_DELETED);
    assert.match(decision.notice, /most likely already deleted/);
    assert.match(decision.notice, /Sign-in is disabled/);
    assert.doesNotMatch(decision.notice, /Sign in again and retry/);
    assert.doesNotMatch(decision.notice, /still signed in/i);
    assert.doesNotMatch(decision.notice, /nothing was deleted/i);
    assert.doesNotMatch(decision.notice, /was confirmed/);
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

test("network errors and server failures are an unknown outcome and can be retried", () => {
  const server = interpretAccountDeletionResponse(500, { ok: false, error: "Internal error" });
  const unavailable = interpretAccountDeletionResponse(503, null);
  const offline = interpretAccountDeletionResponse(0, null, true);
  const again = interpretAccountDeletionResponse(0, null, true, true);
  for (const decision of [server, unavailable, offline, again]) {
    assert.deepEqual(decision, {
      action: "stay",
      message: ACCOUNT_DELETION_UNKNOWN_OUTCOME,
      retry: true,
      unknown: true,
    });
    assert.notEqual(decision.action, "sign-out");
    assert.notEqual(decision.action, "likely-deleted");
    if (decision.action === "stay") {
      assert.match(decision.message, /could not confirm whether the deletion went through/);
      assert.match(decision.message, /If sign-in later reports the account is disabled, the deletion succeeded/);
      assert.doesNotMatch(decision.message, /nothing was deleted/i);
      assert.doesNotMatch(decision.message, /still signed in/i);
    }
  }
  assert.equal(ACCOUNT_DELETION_OFFLINE, ACCOUNT_DELETION_UNKNOWN_OUTCOME);
  assert.equal(ACCOUNT_DELETION_SERVER_ERROR, ACCOUNT_DELETION_UNKNOWN_OUTCOME);
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
  assert.deepEqual(offline, {
    action: "stay",
    message: ACCOUNT_DELETION_OFFLINE,
    retry: true,
    unknown: true,
  });
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

test("a lost request is remembered, and a later 401 or missing token is not a fresh sign-in", async () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
  };
  assert.equal(unknownDeletionAttempt(storage), false);
  rememberUnknownDeletionAttempt(storage);
  assert.equal(memory.get(ACCOUNT_DELETION_UNKNOWN_KEY), "1");
  assert.equal(unknownDeletionAttempt(storage), true);

  let calls = 0;
  const refreshed = await requestAccountDeletion("token-1", async () => {
    calls += 1;
    return { status: 401, json: async () => ({ ok: false, error: "Sign in again." }) };
  }, unknownDeletionAttempt(storage));
  assert.equal(calls, 1);
  assert.equal(refreshed.action, "likely-deleted");

  const noToken = await requestAccountDeletion(null, async () => {
    calls += 1;
    return { status: 200, json: async () => ({ ok: true, disabled: true }) };
  }, true);
  assert.equal(calls, 1);
  assert.equal(noToken.action, "likely-deleted");
  if (noToken.action === "likely-deleted") assert.equal(noToken.notice, ACCOUNT_DELETION_LIKELY_DELETED);

  const firstTime = await requestAccountDeletion(null, async () => {
    calls += 1;
    return { status: 200, json: async () => ({ ok: true, disabled: true }) };
  }, false);
  assert.equal(calls, 1);
  assert.deepEqual(firstTime, { action: "stay", message: ACCOUNT_DELETION_SIGN_IN_AGAIN, retry: true });
  stays(firstTime);

  clearUnknownDeletionAttempt(storage);
  assert.equal(unknownDeletionAttempt(storage), false);
});

test("the email path signs out only after the person confirms they sent it", async () => {
  const sent = emailHandoffChoice(true);
  assert.equal(sent.action, "sign-out");
  if (sent.action !== "sign-out") return;
  assert.equal(sent.notice, ACCOUNT_DELETION_EMAIL_NOTICE);
  assert.match(sent.notice, new RegExp(ACCOUNT_DELETION_MAILBOX.replace(".", "\\.")));
  assert.match(sent.notice, /sent the deletion email/);
  assert.doesNotMatch(sent.notice, /was opened/);
  assert.doesNotMatch(sent.notice, /was confirmed/);

  const notYet = emailHandoffChoice(false);
  assert.equal(notYet.action, "stay");
  if (notYet.action !== "stay") return;
  assert.equal(notYet.retry, false);
  assert.equal(notYet.message, ACCOUNT_DELETION_EMAIL_NOT_SENT);
  assert.match(notYet.message, new RegExp(ACCOUNT_DELETION_MAILBOX.replace(".", "\\.")));
  assert.match(notYet.message, /still signed in/i);
  assert.doesNotMatch(notYet.message, /was opened/);

  let checks = 0;
  await waitUntilAppIsVisible({
    hidden: () => {
      checks += 1;
      return checks < 3;
    },
    wait: async () => {},
    settleMs: 0,
    pollMs: 0,
  });
  assert.ok(checks >= 3);

  let stayedVisible = 0;
  await waitUntilAppIsVisible({
    hidden: () => {
      stayedVisible += 1;
      return false;
    },
    wait: async () => {},
    settleMs: 0,
  });
  assert.equal(stayedVisible, 1);

  assert.match(ACCOUNT_DELETION_SERVER_SIGNOUT_FAILED, /Your account deletion was confirmed/);
  assert.match(ACCOUNT_DELETION_EMAIL_SIGNOUT_FAILED, /request email was sent/);
  assert.match(ACCOUNT_DELETION_EMAIL_SIGNOUT_FAILED, /Sign out from More/);
  assert.doesNotMatch(ACCOUNT_DELETION_EMAIL_SIGNOUT_FAILED, /was confirmed/);
  assert.doesNotMatch(ACCOUNT_DELETION_LIKELY_DELETED, /was confirmed/);
});

test("the screen confirms the outcome before deleting and signs out only from a confirmed result", () => {
  const source = readFileSync(path.join(root, "app/mobile/_components/AccountDeletion.tsx"), "utf8");
  assert.match(source, /ACCOUNT_DELETION_CONFIRMATION/);
  assert.match(ACCOUNT_DELETION_CONFIRMATION, /disables sign-in right away/);
  assert.match(ACCOUNT_DELETION_CONFIRMATION, /within 30 days/);
  assert.match(ACCOUNT_DELETION_CONFIRMATION, /company's lead records/);
  assert.match(ACCOUNT_DELETION_CONFIRMATION, /only after you confirm that you sent that email/);
  assert.match(source, /requestAccountDeletion/);
  assert.match(source, /emailHandoffChoice\(true\)/);
  assert.match(source, /emailHandoffChoice\(false\)/);
  assert.match(source, /I sent it, sign me out/);
  assert.match(source, /Not yet/);
  assert.match(source, /ACCOUNT_DELETION_EMAIL_QUESTION/);
  assert.match(ACCOUNT_DELETION_EMAIL_QUESTION, new RegExp(ACCOUNT_DELETION_MAILBOX.replace(".", "\\.")));
  assert.match(source, /rememberUnknownDeletionAttempt/);
  assert.match(source, /unknownOutcome/);
  assert.match(source, /ACCOUNT_DELETION_LIKELY_DELETED/);
  assert.match(source, /visibilityState === "hidden"/);
  assert.doesNotMatch(source, /appStateChange|hasFocus\(|resolveMailtoHandoff|afterMailtoHandoff/);
  assert.doesNotMatch(source, /Your account deletion was confirmed/);
  const serverHandoff = source.indexOf('await finishSignOut(decision.notice, "server")');
  const serverGuard = source.lastIndexOf('decision.action === "sign-out"', serverHandoff);
  assert.ok(serverHandoff > serverGuard && serverGuard > 0);
  const emailHandoff = source.indexOf('await finishSignOut(choice.notice, "email")');
  const emailGuard = source.lastIndexOf("emailHandoffChoice(true)", emailHandoff);
  assert.ok(emailHandoff > emailGuard && emailGuard > 0);
  assert.match(source, /source === "server" \? ACCOUNT_DELETION_SERVER_SIGNOUT_FAILED : ACCOUNT_DELETION_EMAIL_SIGNOUT_FAILED/);
  assert.equal(source.match(/await signOut\(\)/g)?.length, 2);
  assert.equal(source.match(/finishSignOut\(/g)?.length, 3);
  assert.doesNotMatch(source, /deleteDoc|removeDraft|deleteDatabase|localStorage\.clear|\/api\/admin\/delete-user/);
  const policy = readFileSync(path.join(root, "app/mobile/_lib/accountPolicy.ts"), "utf8");
  assert.doesNotMatch(policy, /is not a successful handoff|mail app actually takes over|inactive = true/);
});
