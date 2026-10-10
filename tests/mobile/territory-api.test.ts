import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createTerritoryHandlers } from "../../app/utils/server/territoryManagement";

// In-memory adapter runs the real route handlers. No Firebase credentials/network.
function fixture() {
  const records = new Map<
    string,
    { value: Record<string, any>; revision: number }
  >();
  let revision = 0,
    failCommit = false;
  const seed = (path: string, value: Record<string, any>) =>
    records.set(path, { value: structuredClone(value), revision: ++revision });
  const ref = (path: string) => ({
    path,
    id: path.split("/").at(-1),
    get: async () => snap(path),
  });
  const snap = (path: string) => {
    const d = records.get(path);
    return {
      id: path.split("/").at(-1),
      ref: ref(path),
      exists: !!d,
      data: () => (d ? structuredClone(d.value) : undefined),
      updateTime: d ? { seconds: d.revision, nanoseconds: 0 } : undefined,
    };
  };
  function collection(name: string, filters: any[] = [], cap = Infinity) {
    const q = {
      doc: (id: string) => ref(`${name}/${id}`),
      where: (...f: any[]) => collection(name, [...filters, f], cap),
      limit: (n: number) => collection(name, filters, n),
      select: () => q,
      get: async () => {
        const docs = [...records.keys()]
          .filter((p) => p.startsWith(`${name}/`))
          .map(snap)
          .filter((d) =>
            filters.every(([field, op, val]) =>
              op === ">=" ? d.data()![field] >= val : d.data()![field] <= val
            )
          )
          .slice(0, cap);
        return { docs, size: docs.length };
      },
    };
    return q;
  }
  const db = {
    collection,
    runTransaction: async (fn: any) => {
      const writes: Array<() => void> = [];
      const tx = {
        get: async (r: any) => r.get(),
        getAll: async (...refs: any[]) => Promise.all(refs.map((r) => r.get())),
        update: (r: any, d: any) =>
          writes.push(() =>
            seed(r.path, { ...records.get(r.path)!.value, ...d })
          ),
        create: (r: any, d: any) => writes.push(() => seed(r.path, d)),
        set: (r: any, d: any) => writes.push(() => seed(r.path, d)),
        delete: (r: any) => writes.push(() => records.delete(r.path)),
      };
      const result = await fn(tx);
      if (failCommit)
        throw Object.assign(new Error("Simulated failure"), { status: 503 });
      writes.forEach((w) => w());
      return result;
    },
  };
  seed("users/manager", { name: "Manager", role: "manager", team: "A" });
  seed("users/rep", { name: "Rep", role: "setter", team: "A" });
  seed("users/next", { name: "Next", role: "setter", team: "A" });
  seed("users/outsider", { name: "Other", role: "setter", team: "B" });
  seed("users/admin", { name: "Admin", role: "admin" });
  const handlers = createTerritoryHandlers({
    adminDb: () => db,
    adminAuth: () => ({
      verifyIdToken: async (token: string) => {
        if (token === "bad") throw Error();
        return { uid: token };
      },
    }),
  } as unknown as Parameters<typeof createTerritoryHandlers>[0]);
  const request = async (body?: Record<string, unknown>, actor = "manager") => {
    const req = new NextRequest(
      "https://example.com/api/territory-management",
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${actor}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }
    );
    const result = await (body ? handlers.POST(req) : handlers.GET(req));
    return { status: result.status, body: await result.json() };
  };
  return {
    request,
    seed,
    records,
    setFailure: (v: boolean) => {
      failCommit = v;
    },
  };
}
const polygon = [
  { lat: 43, lng: -77 },
  { lat: 43, lng: -76.99 },
  { lat: 43.01, lng: -76.99 },
  { lat: 43.01, lng: -77 },
];
const requestId = "11111111-1111-4111-8111-111111111111";

test("API rejects reps, revoked sessions and cross-team assignment", async () => {
  const f = fixture();
  assert.equal((await f.request(undefined, "rep")).status, 403);
  assert.equal((await f.request(undefined, "bad")).status, 401);
  assert.deepEqual(
    (await f.request()).body.members.map((m: any) => m.id).sort(),
    ["manager", "next", "rep"]
  );
  assert.equal(
    (await f.request({ action: "preview", userId: "outsider", polygon }))
      .status,
    403
  );
  f.seed("users/manager", {
    name: "Manager",
    role: "manager",
    team: "A",
    approved: false,
  });
  assert.equal((await f.request()).status, 403);
});
test("review/create is atomic, idempotent and preserves existing appointments", async () => {
  const f = fixture();
  f.seed("leads/free", {
    lat: 43.005,
    lng: -76.995,
    status: "unclaimed",
    notes: "Keep this note",
  });
  f.seed("leads/worked", {
    lat: 43.006,
    lng: -76.995,
    status: "appointment",
    claimedBy: "rep",
    appointmentOutcome: "Sold",
  });
  const review = await f.request({ action: "preview", userId: "rep", polygon });
  assert.equal(review.body.eligible, 1);
  assert.equal(review.body.skipped, 1);
  const body = {
    action: "create",
    userId: "rep",
    polygon,
    name: "Test area",
    candidates: review.body.candidates.filter((c: any) => c.eligible),
    requestId,
  };
  f.setFailure(true);
  assert.equal((await f.request(body)).status, 503);
  assert.equal(f.records.has(`territories/${requestId}`), false);
  assert.equal(f.records.get("leads/free")!.value.assignedTo, undefined);
  f.setFailure(false);
  const saved = await f.request(body);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.changed, 1);
  assert.equal(f.records.get("leads/free")!.value.notes, "Keep this note");
  assert.equal(f.records.get("leads/worked")!.value.appointmentOutcome, "Sold");
  assert.equal((await f.request(body)).body.replayed, true);
  const data = (await f.request()).body;
  assert.equal(data.territories.length, 1);
  assert.equal(
    (
      await f.request({
        ...body,
        requestId: "22222222-2222-4222-8222-222222222222",
        candidates: [],
      })
    ).status,
    409
  ); // Overlap.
});
test("stale previews, forged candidates and stale territory edits fail without writes", async () => {
  const f = fixture();
  f.seed("leads/free", { lat: 43.005, lng: -76.995, status: "unclaimed" });
  const preview = (
    await f.request({ action: "preview", userId: "rep", polygon })
  ).body;
  f.seed("leads/free", {
    lat: 43.005,
    lng: -76.995,
    status: "claimed",
    claimedBy: "outsider",
  });
  assert.equal(
    (
      await f.request({
        action: "create",
        userId: "rep",
        polygon,
        name: "Test",
        requestId,
        candidates: preview.candidates,
      })
    ).status,
    409
  );
  assert.equal(f.records.has(`territories/${requestId}`), false);
  f.seed("territories/area", {
    name: "Existing",
    userId: "outsider",
    polygon,
    leadIds: [],
  });
  assert.equal(
    (
      await f.request({
        action: "rename",
        id: "area",
        name: "Stolen",
        version: "wrong",
        requestId,
      })
    ).status,
    409
  );
  const other = (await f.request(undefined, "admin")).body.territories[0];
  assert.equal(
    (
      await f.request({
        action: "rename",
        id: "area",
        name: "Stolen",
        version: other.version,
        requestId,
      })
    ).status,
    403
  );
});
test("transfer skips active or reassigned leads; boundary removal preserves every lead", async () => {
  const f = fixture();
  f.seed("territories/area", {
    name: "Existing",
    userId: "rep",
    userName: "Rep",
    polygon,
    leadIds: ["free", "claimed", "moved"],
  });
  f.seed("leads/free", {
    lat: 43.005,
    lng: -76.995,
    status: "assigned",
    assignedTo: "rep",
    notes: "Keep",
  });
  f.seed("leads/claimed", {
    lat: 43.005,
    lng: -76.995,
    status: "assigned",
    assignedTo: "rep",
    claimedBy: "rep",
  });
  f.seed("leads/moved", {
    lat: 43.005,
    lng: -76.995,
    status: "assigned",
    assignedTo: "outsider",
  });
  let area = (await f.request()).body.territories[0];
  const transfer = await f.request({
    action: "transfer",
    id: "area",
    userId: "next",
    version: area.version,
    requestId,
  });
  assert.equal(transfer.status, 200);
  assert.equal(transfer.body.changed, 1);
  assert.equal(transfer.body.skipped, 2);
  assert.equal(f.records.get("leads/free")!.value.assignedTo, "next");
  assert.equal(f.records.get("leads/claimed")!.value.assignedTo, "rep");
  assert.equal(f.records.get("leads/moved")!.value.assignedTo, "outsider");
  area = (await f.request()).body.territories[0];
  const before = JSON.stringify(
    [...f.records].filter(([k]) => k.startsWith("leads/"))
  );
  const body = {
    action: "archive",
    id: "area",
    version: area.version,
    requestId: "22222222-2222-4222-8222-222222222222",
  };
  assert.equal((await f.request(body)).status, 200);
  assert.equal((await f.request()).body.territories.length, 0);
  assert.equal((await f.request(body)).body.replayed, true);
  assert.equal(
    JSON.stringify([...f.records].filter(([k]) => k.startsWith("leads/"))),
    before
  );
});
