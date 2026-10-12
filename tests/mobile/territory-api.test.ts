import test from "node:test";
import assert from "node:assert/strict";

import { fixture } from "./helpers/territoryFixture";
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

test("bulk territory deletion is scoped, versioned, atomic, retryable and never edits pins", async()=>{
 const f=fixture();f.seed("leads/history",{status:"appointment",assignedTo:"rep",notes:"Keep",dispositionHistory:[{userId:"rep"}]});
 f.seed("territories/a",{name:"A",userId:"rep",polygon,leadIds:["history"]});f.seed("territories/b",{name:"B",userId:"rep",polygon,leadIds:[]});f.seed("territories/c",{name:"C",userId:"outsider",polygon,leadIds:[]});
 const data=(await f.request()).body,items=data.territories.map((t:any)=>({id:t.id,version:t.version}));
 const body={action:"archive-many",userId:"rep",territories:items,requestId};
 assert.equal((await f.request({...body,userId:"outsider"})).status,403);
 assert.equal((await f.request({...body,territories:[...items,{id:"c",version:"bad"}]})).status,409);
 assert.equal(f.records.has("territories/a"),true);
 const before=structuredClone(f.records.get("leads/history"));f.setFailure(true);assert.equal((await f.request(body)).status,503);assert.equal(f.records.has("territories/b"),true);f.setFailure(false);
 assert.equal((await f.request(body)).body.removed,2);assert.equal((await f.request(body)).body.removed,0);assert.deepEqual(f.records.get("leads/history"),before);assert.equal(f.records.has("territories/c"),true);
});

test("a user pending deletion cannot receive territory or act as manager",async()=>{
 const f=fixture();f.seed("users/rep",{role:"setter",team:"A",deletionPending:true});assert.equal((await f.request({action:"preview",userId:"rep",polygon})).status,403);f.seed("users/manager",{role:"manager",team:"A",isActive:false});assert.equal((await f.request()).status,403);
});
