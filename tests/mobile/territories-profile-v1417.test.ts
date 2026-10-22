import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTH_READY_TIMEOUT_MS,
  MANAGER_ONLY_MESSAGE,
  SIGN_IN_AGAIN_MESSAGE,
  SIGN_IN_TIMEOUT_MESSAGE,
  TERRITORIES_LOAD_TIMEOUT_MS,
  TERRITORIES_TIMEOUT_MESSAGE,
  TERRITORY_SERVER_UPDATE_MESSAGE,
  TERRITORY_SERVICE_UNAVAILABLE_MESSAGE,
  loadTerritories,
  type LoadTerritoriesDeps,
  type TerritoryHttpResult,
  type TerritoryLoadResult,
  type TerritoryTimers,
} from "../../app/mobile/territories/loadTerritories";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROFILE_TIMEOUT = "Your account profile is taking too long to load. Check your connection, then try again.";

function actor(role: string, extra: Record<string, unknown> = {}) {
  return {
    id: "brooke",
    name: "Brooke",
    color: "#587E98",
    team: "Buffalo",
    role,
    approved: true,
    approvalStatus: "approved",
    isActive: true,
    ...extra,
  };
}

function summary(person: ReturnType<typeof actor>, territories: unknown[] = []) {
  return { actor: person, members: [person], territories, capabilities: { pagedAssignments: true } };
}

function http(status: number, body: unknown, contentType: string | null = "application/json"): TerritoryHttpResult {
  return { status, contentType, body };
}

function deps(overrides: Partial<LoadTerritoriesDeps> = {}): LoadTerritoriesDeps {
  return {
    authReady: async () => {},
    currentUser: () => ({ uid: "brooke" }),
    request: async () => http(200, summary(actor("admin"))),
    ...overrides,
  };
}

function clock() {
  const pending: { ms: number; fn: () => void; cleared: boolean }[] = [];
  const timers: TerritoryTimers = {
    setTimeout(fn, ms) {
      const entry = { ms, fn, cleared: false };
      pending.push(entry);
      return entry;
    },
    clearTimeout(handle) {
      if (handle && typeof handle === "object" && "cleared" in handle) handle.cleared = true;
    },
  };
  return {
    timers,
    pending(ms: number) {
      return pending.some((entry) => !entry.cleared && entry.ms === ms);
    },
    fire(ms: number) {
      for (const entry of pending) {
        if (!entry.cleared && entry.ms === ms) {
          entry.cleared = true;
          entry.fn();
        }
      }
    },
  };
}

async function until(predicate: () => boolean) {
  for (let i = 0; i < 20 && !predicate(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(predicate(), true);
}

function assertError(outcome: TerritoryLoadResult, message: string, signIn = false) {
  assert.equal(outcome.type, "error");
  if (outcome.type !== "error") return;
  assert.equal(outcome.message, message);
  assert.equal(outcome.signIn, signIn);
  assert.equal("data" in outcome, false);
}

test("territories page and loader do not read Firestore or the client profile", () => {
  for (const file of ["app/mobile/territories/page.tsx", "app/mobile/territories/loadTerritories.ts"]) {
    const source = readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /\bgetDoc\b/);
    assert.doesNotMatch(source, /firebase\/firestore/);
    assert.doesNotMatch(source, /getCurrentAuthUser/);
    assert.doesNotMatch(source, /observeMobileSession/);
    assert.doesNotMatch(source, /\bsignOut\b/);
    assert.doesNotMatch(source, /localStorage|sessionStorage/);
  }
  const page = readFileSync(path.join(root, "app/mobile/territories/page.tsx"), "utf8");
  assert.match(page, /auth\.authStateReady\(\)/);
  assert.match(page, /TERRITORY_SUMMARY_PATH/);
  assert.match(page, /router\.replace\(outcome\.href\)/);
  assert.match(page, /router\.push\("\/login"\)/);
  assert.match(page, /MOBILE_BUILD_LABEL/);
  assert.match(page, /outcome\.type === "ready"/);
  assert.match(page, /<TerritoryWorkspace/);
  assert.equal(page.match(/router\.replace/g)?.length, 1);
});

test("a signed-in admin loads territories with one GET and no profile read", async () => {
  let gets = 0;
  const outcome = await loadTerritories(deps({
    request: async () => {
      gets += 1;
      return http(200, summary(actor("admin"), [{ id: "north" }]));
    },
  }));
  assert.equal(gets, 1);
  assert.equal(outcome.type, "ready");
  if (outcome.type !== "ready") return;
  assert.equal(outcome.data.actor.role, "admin");
  assert.deepEqual(outcome.data.territories, [{ id: "north" }]);
});

test("a Firestore getDoc that never resolves does not block territories", { timeout: 1_000 }, async () => {
  let reads = 0;
  const input: LoadTerritoriesDeps & { getDoc?: () => Promise<unknown> } = deps();
  input.getDoc = () => {
    reads += 1;
    return new Promise(() => {});
  };
  const outcome = await loadTerritories(input);
  assert.equal(reads, 0);
  assert.equal(typeof input.getDoc, "function");
  assert.equal(outcome.type, "ready");
});

test("no current user after auth is ready redirects to login without a GET", async () => {
  let gets = 0;
  const outcome = await loadTerritories(deps({
    currentUser: () => null,
    request: async () => {
      gets += 1;
      return http(200, summary(actor("admin")));
    },
  }));
  assert.equal(gets, 0);
  assert.deepEqual(outcome, { type: "redirect", href: "/login" });
});

test("authStateReady hanging past 12s reports sign-in timeout and does not GET", async () => {
  const time = clock();
  let gets = 0;
  const pending = loadTerritories(deps({
    authReady: () => new Promise(() => {}),
    timers: time.timers,
    request: async () => {
      gets += 1;
      return http(200, summary(actor("admin")));
    },
  }));
  assert.equal(time.pending(AUTH_READY_TIMEOUT_MS), true);
  time.fire(AUTH_READY_TIMEOUT_MS);
  const outcome = await pending;
  assertError(outcome, SIGN_IN_TIMEOUT_MESSAGE);
  assert.match(SIGN_IN_TIMEOUT_MESSAGE, /Sign-in is taking too long/);
  assert.doesNotMatch(SIGN_IN_TIMEOUT_MESSAGE, /account profile/);
  assert.equal(gets, 0);
});

test("401 asks the user to sign in again without signing out or clearing storage", async () => {
  let gets = 0;
  const outcome = await loadTerritories(deps({
    request: async () => {
      gets += 1;
      return http(401, { error: "Token revoked" });
    },
  }));
  assert.equal(gets, 1);
  assertError(outcome, SIGN_IN_AGAIN_MESSAGE, true);
  assert.notEqual(SIGN_IN_AGAIN_MESSAGE, "Token revoked");
});

test("403 shows the server text, and a non-JSON 403 uses the manager fallback", async () => {
  const withText = await loadTerritories(deps({
    request: async () => http(403, { error: "Your Buffalo account is not approved for territories." }),
  }));
  assertError(withText, "Your Buffalo account is not approved for territories.");

  const withoutJson = await loadTerritories(deps({
    request: async () => http(403, null, "text/html"),
  }));
  assertError(withoutJson, MANAGER_ONLY_MESSAGE);

  const emptyError = await loadTerritories(deps({
    request: async () => http(403, { error: "  " }),
  }));
  assertError(emptyError, MANAGER_ONLY_MESSAGE);
});

test("404 without JSON and other failures keep the existing territory messages", async () => {
  const missing = await loadTerritories(deps({
    request: async () => http(404, null, "text/html"),
  }));
  assertError(missing, TERRITORY_SERVER_UPDATE_MESSAGE);

  const busy = await loadTerritories(deps({
    request: async () => http(500, { error: "Database busy" }),
  }));
  assertError(busy, "Database busy");

  const gateway = await loadTerritories(deps({
    request: async () => http(502, null, null),
  }));
  assertError(gateway, TERRITORY_SERVICE_UNAVAILABLE_MESSAGE);

  const bare = await loadTerritories(deps({
    request: async () => http(503, {}),
  }));
  assertError(bare, "Territories could not be loaded (HTTP 503).");
});

test("a GET that hangs past 20s times out, and Try again issues exactly one new GET", async () => {
  const time = clock();
  let gets = 0;
  const request = () => {
    gets += 1;
    if (gets === 1) return new Promise<TerritoryHttpResult>(() => {});
    return Promise.resolve(http(200, summary(actor("manager"))));
  };
  const pending = loadTerritories(deps({ request, timers: time.timers }));
  await until(() => time.pending(TERRITORIES_LOAD_TIMEOUT_MS));
  assert.equal(gets, 1);
  time.fire(TERRITORIES_LOAD_TIMEOUT_MS);
  const timedOut = await pending;
  assertError(timedOut, TERRITORIES_TIMEOUT_MESSAGE);
  assert.doesNotMatch(TERRITORIES_TIMEOUT_MESSAGE, /account profile/);
  assert.notEqual(TERRITORIES_TIMEOUT_MESSAGE, PROFILE_TIMEOUT);

  const retried = await loadTerritories(deps({ request, timers: time.timers }));
  assert.equal(gets, 2);
  assert.equal(retried.type, "ready");
  if (retried.type !== "ready") return;
  assert.equal(retried.data.actor.role, "manager");
});

test("a successful setter response stays on the manager message and cannot open the workspace", async () => {
  for (const role of ["setter", "closer", "rep"]) {
    const outcome = await loadTerritories(deps({
      request: async () => http(200, summary(actor(role))),
    }));
    assertError(outcome, MANAGER_ONLY_MESSAGE);
  }
  const inactiveAdmin = await loadTerritories(deps({
    request: async () => http(200, summary(actor("admin", { approved: false }))),
  }));
  assertError(inactiveAdmin, MANAGER_ONLY_MESSAGE);

  const manager = await loadTerritories(deps({
    request: async () => http(200, summary(actor("manager"))),
  }));
  assert.equal(manager.type, "ready");
});
