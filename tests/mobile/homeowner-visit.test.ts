import test from 'node:test';
import assert from 'node:assert/strict';
import type { Homeowner } from '../../app/homeowners/model';
import type { Lead, User } from '../../app/types';
import { createHomeownerVisit, homeownerVisitDraft } from '../../app/homeowners/visit';
const home = { id: 'h1', ownerName: 'Fictional Owner', address: '101 Example St', municipality: 'Rochester', state: 'NY', mailingZip: '99999', lat: 43.15, lng: -77.6, occupancyStatus: 'Owner-Occupied' } as Homeowner;
const user = { id: 'rep1', name: 'FMA', role: 'setter' } as User;
function setup() {
  const writes: {kind: string; id: string; data: Partial<Lead>}[] = [];
  let active = true, online = true, fail = false;
  const visit = createHomeownerVisit(homeownerVisitDraft(home, user, 'stable-id'), {
    create: async l => { if (fail) throw Error('Denied'); writes.push({kind:'create', id:l.id, data:l}); },
    update: async (id, data) => { if (fail) throw Error('Denied'); writes.push({kind:'update', id, data}); },
    active: () => active, online: () => online,
  });
  return {visit,writes, active:(v:boolean)=>active=v, online:(v:boolean)=>online=v, fail:(v:boolean)=>fail=v};
}
test('selecting a home creates only a local draft; mailing ZIP is not copied to property ZIP', () => {
  const {visit,writes}=setup(); assert.equal(writes.length,0); assert.equal(visit.saved,false);
  assert.equal(visit.lead.zip,''); assert.equal(visit.lead.name,home.ownerName);
  assert.equal(visit.lead.claimedBy,user.id); assert.equal(visit.lead.source,'manually-added');
});
test('first outcome is one lead create, subsequent notes are partial writes, with homeowner info and history retained',async()=>{
  const {visit,writes}=setup(); const history=[{disposition:'Not Home',timestamp:new Date(),userId:user.id,userName:user.name}];
  await visit.save({status:'not-home',dispositionHistory:history,dispositionedAt:new Date()});
  assert.equal(writes.length,1); assert.equal(writes[0].kind,'create'); assert.equal(writes[0].data.status,'not-home');
  await visit.save({notes:'Dog in yard'}); assert.deepEqual(writes[1].data,{notes:'Dog in yard'});
  assert.equal(visit.lead.homeowner,home); assert.deepEqual(visit.lead.dispositionHistory,history);
  assert.ok(writes.every(w=>w.id==='stable-id')); assert.equal(home.occupancyStatus,'Owner-Occupied');
});
test('failed save retains the same draft ID; retry creates one visit, no duplicate history',async()=>{
  const s=setup();s.fail(true);await assert.rejects(s.visit.save({status:'interested'}),/Denied/);
  assert.equal(s.visit.saved,false);assert.equal(s.visit.lead.status,'unclaimed');s.fail(false);
  await s.visit.save({status:'interested'});assert.equal(s.writes.length,1);assert.equal(s.writes[0].id,'stable-id');
});
test('offline or changed account cannot create a home visit',async()=>{
  const s=setup();s.online(false);await assert.rejects(s.visit.save(),/Connect/);s.online(true);s.active(false);
  await assert.rejects(s.visit.save(),/account changed/);assert.equal(s.writes.length,0);
});
test('field queue preparation creates once and does not reset status on repeat',async()=>{
  const s=setup();await s.visit.prepare();await s.visit.save({status:'not-home'});await s.visit.prepare();
  assert.equal(s.writes.filter(w=>w.kind==='create').length,1);assert.equal(s.visit.lead.status,'not-home');
});
test('rapid concurrent writes are blocked until the first write settles',async()=>{
  let finish!:()=>void;let count=0;
  const visit=createHomeownerVisit(homeownerVisitDraft(home,user,'same-id'),{create:async()=>{count++;await new Promise<void>(r=>finish=r);},update:async()=>{},active:()=>true,online:()=>true});
  const first=visit.save({status:'not-home'});await assert.rejects(visit.save({status:'interested'}),/still saving/);
  finish();await first;assert.equal(count,1);assert.equal(visit.lead.status,'not-home');
});
test('full modal payloads omit undefined keys and cannot change origin identity',async()=>{
  const s=setup();await s.visit.save({status:'go-back',assignedTo:undefined,id:'wrong',source:'wrong',homeowner:{...home,id:'wrong'}});
  assert.equal(s.visit.lead.id,'stable-id');assert.equal(s.visit.lead.source,'manually-added');assert.equal(s.visit.lead.homeowner,home);
  await s.visit.save({...s.visit.lead,notes:'Return tomorrow',assignedTo:undefined});
  assert.equal('assignedTo' in s.writes[1].data,false);assert.equal('homeowner' in s.writes[1].data,false);
});
