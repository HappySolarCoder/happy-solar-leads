import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createMobileUserHandlers } from "../../app/utils/server/mobileUserManagement";
import { fakeAdmin } from "./fake-admin";
function fixture() {
  const f = fakeAdmin();
  f.seed("users/admin", { name: "Admin", role: "admin" });
  f.seed("users/manager", { name: "Manager", role: "manager" });
  f.seed("users/rep", { name: "Former Rep", role: "setter" });
  f.authUsers.add("rep");
  const h = createMobileUserHandlers({
    adminDb: () => f.db,
    adminAuth: () => f.auth,
  } as unknown as Parameters<typeof createMobileUserHandlers>[0]);
  const request = async (body?: Record<string, unknown>, actor = "admin") => {
    const r = new NextRequest(
      "https://example.com/api/mobile-user-management",
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${actor}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }
    );
    const res = await (body ? h.POST(r) : h.GET(r));
    return { status: res.status, body: await res.json() };
  };
  const payload = async () => ({
    action: "delete",
    userId: "rep",
    version: (await request()).body.users.find((u: any) => u.id === "rep")
      .version,
  });
  return { ...f, request, payload };
}
test("user deletion rejects non-admin, self, revoked sessions and stale profile without changes", async () => {
  const f = fixture(),
    p = await f.payload();
  assert.equal((await f.request(p, "manager")).status, 403);
  assert.equal((await f.request(p, "bad")).status, 401);
  assert.equal((await f.request({ ...p, userId: "admin" })).status, 403);
  assert.equal((await f.request({ ...p, version: "old" })).status, 409);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.authCalls, []);
  f.seed("users/admin", { role: "admin", deleted: true });
  assert.equal((await f.request(p)).status, 403);
});
test("account deletion removes Auth/profile and territory boundaries while lead and history records are byte-for-byte preserved", async () => {
  const f = fixture();
  const lead = {
    status: "appointment",
    claimedBy: "rep",
    assignedTo: "rep",
    notes: "Keep",
    appointmentOutcome: "Sold",
    dispositionHistory: [
      { userId: "rep", userName: "Former Rep", disposition: "Appointment Set" },
    ],
  };
  f.seed("leads/a", lead);
  f.seed("disposition_history/event", { userId: "rep", notes: "Keep history" });
  f.seed("territories/a", { userId: "rep", leadIds: ["a"] });
  f.seed("territories/other", { userId: "manager" });
  const p = await f.payload(),
    before = structuredClone(f.records.get("leads/a"));
  const response = await f.request(p);
  assert.equal(response.status, 200);
  assert.equal(response.body.done, true);
  assert.equal(f.authUsers.has("rep"), false);
  assert.equal(f.records.has("users/rep"), false);
  assert.equal(f.records.has("territories/a"), false);
  assert.equal(f.records.has("territories/other"), true);
  assert.deepEqual(f.records.get("leads/a"), before);
  assert.deepEqual(f.records.get("disposition_history/event")?.value, {
    userId: "rep",
    notes: "Keep history",
  });
  assert.equal(f.records.get("deleted_users/rep")?.value.name, "Former Rep");
  assert.equal(
    f.records.get("deleted_users/rep")?.value.deletionComplete,
    true
  );
  assert.ok(
    f.writes.every(
      (p) => !p.startsWith("leads/") && !p.startsWith("disposition_history/")
    )
  );
  assert.ok(!f.reads.includes("query:leads"));
  assert.deepEqual(f.authCalls, ["disable:rep", "revoke:rep", "delete:rep"]);
  assert.equal((await f.request(p)).body.replayed, true);
});
test("large account deletion is bounded and Auth failures remain retryable without claiming success", async () => {
  const f = fixture();
  for (let i = 0; i < 205; i++) f.seed(`territories/t${i}`, { userId: "rep" });
  const p = await f.payload();
  let result = await f.request(p);
  assert.equal(result.body.done, false);
  assert.equal(result.body.removed, 100);
  assert.equal(f.authUsers.has("rep"), true);
  assert.equal(f.records.get("users/rep")?.value.deletionPending, true);
  result = await f.request(p);
  assert.equal(result.body.removed, 100);
  f.errors.authDelete = true;
  result = await f.request(p);
  assert.equal(result.status, 503);
  assert.equal(f.records.has("users/rep"), true);
  assert.equal(
    f.records.get("deleted_users/rep")?.value.deletionComplete,
    false
  );
  f.errors.authDelete = false;
  result = await f.request(p);
  assert.equal(result.body.done, true);
  assert.equal(f.records.has("users/rep"), false);
  assert.equal(
    [...f.records.keys()].filter((p) => p.startsWith("territories/")).length,
    0
  );
});
test("transaction failure does not disable Auth or delete territory/profile", async () => {
  const f = fixture(),
    p = await f.payload();
  f.seed("territories/a", { userId: "rep" });
  f.errors.commit = true;
  assert.equal((await f.request(p)).status, 503);
  assert.equal(f.records.has("users/rep"), true);
  assert.equal(f.records.has("territories/a"), true);
  assert.deepEqual(f.authCalls, []);
});
