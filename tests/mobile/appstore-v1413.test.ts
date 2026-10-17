import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCOUNT_DELETION_MAILBOX,
  ACCOUNT_DELETION_OUTCOME,
  PRIVACY_POLICY_URL,
  deletionBlockedReason,
  deletionMailto,
  missingAccountMessage,
  nativeSelfSignupEnabled,
  pendingOutboxWork,
  teamPerformanceMayRequestAllLeads,
} from "../../app/mobile/_lib/accountPolicy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

test("the privacy policy address lives in one constant", () => {
  assert.equal(PRIVACY_POLICY_URL, "https://www.happyslr.com/privacy");
  const hits = sourceFiles(path.join(root, "app"))
    .filter((file) => readFileSync(file, "utf8").includes(PRIVACY_POLICY_URL))
    .map((file) => path.relative(root, file));
  assert.deepEqual(hits, ["app/mobile/_lib/accountPolicy.ts"]);
  const login = readFileSync(path.join(root, "app/login/page.tsx"), "utf8");
  const more = readFileSync(path.join(root, "app/mobile/more/page.tsx"), "utf8");
  assert.match(login, /PRIVACY_POLICY_URL/);
  assert.match(more, /PRIVACY_POLICY_URL/);
  assert.match(login, /Privacy policy/);
  assert.match(more, /Privacy policy/);
});

test("the native login does not offer self-signup and the website login still does", () => {
  assert.equal(nativeSelfSignupEnabled(true), false);
  assert.equal(nativeSelfSignupEnabled(false), true);
  assert.match(missingAccountMessage(true), /Contact your manager/);
  assert.match(missingAccountMessage(false), /Please create one/);
  const login = readFileSync(path.join(root, "app/login/page.tsx"), "utf8");
  assert.match(login, /NEXT_PUBLIC_NATIVE_BUILD !== '1' && \([\s\S]*Create Account/);
  const signup = readFileSync(path.join(root, "app/signup/page.tsx"), "utf8");
  const guard = signup.indexOf("if (process.env.NEXT_PUBLIC_NATIVE_BUILD === '1')");
  const create = signup.indexOf("createUserWithEmailAndPassword(auth");
  assert.ok(guard > 0 && create > guard);
  assert.match(signup, /does not offer self-signup/);
});

test("native setters and closers do not request company-wide leads; the screen stays available", () => {
  for (const role of ["setter", "closer", "unknown", undefined]) {
    assert.equal(teamPerformanceMayRequestAllLeads(role, true), false);
  }
  assert.equal(teamPerformanceMayRequestAllLeads("manager", true), true);
  assert.equal(teamPerformanceMayRequestAllLeads("admin", true), true);
  assert.equal(teamPerformanceMayRequestAllLeads("setter", false), true);
  assert.equal(teamPerformanceMayRequestAllLeads("closer", false), true);
  assert.equal(teamPerformanceMayRequestAllLeads("manager", false), true);
  const stats = readFileSync(path.join(root, "app/setter-stats/page.tsx"), "utf8");
  const more = readFileSync(path.join(root, "app/mobile/more/page.tsx"), "utf8");
  assert.match(stats, /teamPerformanceMayRequestAllLeads\(role\)/);
  assert.match(stats, /getLeadsAsync\(\)/);
  assert.ok(stats.indexOf("teamPerformanceMayRequestAllLeads") < stats.indexOf("'/api/stats/all-leads'"));
  assert.match(more, /href: "\/setter-stats"/);
});

test("account deletion requests by email and refuses to continue while outbox work is unread or pending", async () => {
  const link = deletionMailto({ email: "rep&name@happyslr.com", uid: "uid/1" });
  const params = new URLSearchParams(link.slice(link.indexOf("?") + 1));
  assert.ok(link.startsWith(`mailto:${ACCOUNT_DELETION_MAILBOX}?`));
  assert.match(params.get("subject") || "", /deletion/i);
  assert.match(params.get("body") || "", /rep&name@happyslr.com/);
  assert.match(params.get("body") || "", /uid\/1/);
  assert.match(params.get("body") || "", /does not delete or change knock, visit, or lead history/);
  assert.match(ACCOUNT_DELETION_OUTCOME, /visit history|Knocks, visits, and leads/);
  assert.match(ACCOUNT_DELETION_OUTCOME, /signed out/i);
  assert.equal(deletionBlockedReason({ drafts: 0, recordings: 0 }), null);
  assert.match(deletionBlockedReason({ drafts: 1, recordings: 0 }) || "", /1 unsynced visit/);
  assert.match(deletionBlockedReason({ drafts: 2, recordings: 1 }) || "", /2 unsynced visits and 1 unsent recording/);
  assert.match(deletionBlockedReason(null) || "", /Stay signed in/);
  assert.deepEqual(await pendingOutboxWork("u", async () => ["a"], async () => ["b", "c"]), {
    drafts: 1,
    recordings: 2,
  });
  assert.equal(await pendingOutboxWork("u", async () => {
    throw Error("storage unavailable");
  }, async () => []), null);

  const deletion = readFileSync(path.join(root, "app/mobile/_components/AccountDeletion.tsx"), "utf8");
  assert.match(deletion, /readDrafts/);
  assert.match(deletion, /signOut/);
  assert.doesNotMatch(deletion, /deleteDoc|removeDraft|deleteDatabase|localStorage\.clear|\/api\/admin\/delete-user|\/api\/stats\/all-leads/);
  const policy = readFileSync(path.join(root, "app/mobile/_lib/accountPolicy.ts"), "utf8");
  assert.doesNotMatch(policy, /from ["']firebase|deleteDoc|removeDraft|indexedDB/);
});
