import test from "node:test";
import assert from "node:assert/strict";
import {
  observeMobileSession,
  type MobileSession,
} from "../../app/mobile/_lib/mobileSession";
import type { User } from "../../app/types";

function harness() {
  let change: (id: string | null) => void = () => {};
  let fail: () => void = () => {};
  let unsubscribed = false;
  const states: MobileSession[] = [];
  const pending = new Map<
    string,
    { resolve: (user: User | null) => void; reject: () => void }
  >();
  const stop = observeMobileSession(
    (onUser, onError) => {
      change = onUser;
      fail = onError;
      return () => {
        unsubscribed = true;
      };
    },
    (id) =>
      new Promise((resolve, reject) => pending.set(id, { resolve, reject })),
    (state) => states.push(state)
  );
  return {
    change: (id: string | null) => change(id),
    fail: () => fail(),
    pending,
    states,
    stop,
    unsubscribed: () => unsubscribed,
  };
}
const profile = (id: string) => ({ id, name: id, role: "setter" } as User);
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("account switches discard a late previous profile and clear visible data immediately", async () => {
  const h = harness();
  h.change("alice");
  h.change("bob");
  h.pending.get("bob")!.resolve(profile("bob"));
  await flush();
  h.pending.get("alice")!.resolve(profile("alice"));
  await flush();
  assert.equal(h.states.at(-1)?.user?.id, "bob");
  h.change(null);
  assert.deepEqual(h.states.at(-1), { user: null, loading: false, error: "" });
  h.stop();
  assert.equal(h.unsubscribed(), true);
});
test("sign-out or unmount before profile load cannot repopulate a session", async () => {
  for (const action of ["logout", "unmount"]) {
    const h = harness();
    h.change("alice");
    if (action === "logout") h.change(null);
    else h.stop();
    const count = h.states.length;
    h.pending.get("alice")!.resolve(profile("alice"));
    await flush();
    assert.equal(h.states.length, count);
    assert.equal(h.states.at(-1)?.user, null);
    h.stop();
  }
});
test("profile and auth errors leave loading and do not look like a signed-out success", async () => {
  const h = harness();
  h.change("alice");
  h.pending.get("alice")!.reject();
  await flush();
  assert.equal(h.states.at(-1)?.loading, false);
  assert.match(h.states.at(-1)?.error || "", /could not be loaded/);
  h.change("bob");
  h.fail();
  h.pending.get("bob")!.resolve(profile("bob"));
  await flush();
  assert.equal(h.states.at(-1)?.user, null);
  assert.match(h.states.at(-1)?.error || "", /could not be loaded/);
  h.stop();
});
