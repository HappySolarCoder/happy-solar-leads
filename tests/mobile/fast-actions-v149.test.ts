import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveDraftGps,verifiedKnockGps} from '../../app/field/pendingGps';
import {syncOutbox} from '../../app/field/syncOutbox';
import type {PendingMutation} from '../../app/field/types';
import {runTerritoryAssignment,authorizedTerritoryWorker} from '../../app/utils/server/territoryQueue';
import {fixture} from './helpers/territoryFixture';
const draft=():PendingMutation=>({id:'event',leadId:'door',userId:'rep',createdAt:new Date().toISOString(),kind:'knock',baseStatus:'assigned',status:'not-home',direct:{patch:{status:'not-home'},gps:{lat:43,lng:-77,required:true,deadline:Date.now()+15000}}});
const location=()=>({timestamp:Date.now(),coords:{latitude:43,longitude:-77,accuracy:5}});
test('GPS pending holds only its own door; durable completion preserves original knock time',async()=>{
 const m=draft(),at=m.createdAt;let rows=[m,{...draft(),id:'second',leadId:'other',direct:{patch:{status:'not-home'}}}];const sent:string[]=[];
 await syncOutbox({read:async()=>rows,send:async m=>{sent.push(m.id);},remove:async id=>{rows=rows.filter(m=>m.id!==id);},block:async()=>{},active:()=>true});
 assert.deepEqual(sent,['second']);assert.equal(rows.length,1);
 await resolveDraftGps(m,{read:async()=>rows,put:async m=>{rows=[m];},active:()=>true,locate:async()=>location()});
 assert.equal(rows[0].createdAt,at);assert.equal(rows[0].direct?.gps,undefined);assert.equal(rows[0].direct?.patch.knockGpsLat,43);
});
test('GPS rejects old fixes, expired capture, and far-away locations',()=>{
 const m=draft();assert.throws(()=>verifiedKnockGps(m,{...location(),timestamp:Date.now()-60000}),/expired/);
 assert.throws(()=>verifiedKnockGps(m,location(),Date.now()+20000),/expired/);
 assert.throws(()=>verifiedKnockGps(m,{...location(),coords:{latitude:44,longitude:-77,accuracy:5}}),/164 feet/);
});
test('expired recovery never requests current GPS and remains visibly blocked',async()=>{
 const m=draft();m.direct!.gps!.deadline=0;let saved:PendingMutation|undefined;
 await resolveDraftGps(m,{read:async()=>[m],put:async m=>{saved=m;},active:()=>true,locate:async()=>{throw Error('Must not request late GPS');}});
 assert.equal(saved?.blocked,true);assert.match(saved!.error!,/expired/);assert.equal(saved!.createdAt,m.createdAt);
});
test('discard and account changes cannot resurrect a knock during GPS capture',async()=>{
 const m=draft();let puts=0;
 await resolveDraftGps(m,{read:async()=>[],put:async()=>{puts++;},active:()=>true,locate:async()=>location()});assert.equal(puts,0);
 await resolveDraftGps(m,{read:async()=>[m],put:async()=>{puts++;},active:()=>false,locate:async()=>location()});assert.equal(puts,0);
});
test('worker resumes committed pages without a phone and preserves worked pins',async()=>{
 const f=fixture();f.seed('users/manager',{name:'Manager',role:'admin',isActive:true});f.seed('users/rep',{name:'Rep',role:'setter',isActive:true,approved:true});
 const polygon=[{lat:42.99,lng:-77.01},{lat:42.99,lng:-76.99},{lat:43.01,lng:-76.99},{lat:43.01,lng:-77.01}];
 for(let i=0;i<450;i++)f.seed(`leads/p${i.toString().padStart(4,'0')}`,{lat:43,lng:-77,status:'unclaimed'});
 f.seed('leads/worked',{lat:43,lng:-77,status:'not-home',assignedTo:'old',dispositionHistory:[{userId:'old'}]});
 const began=await f.request({action:'begin-assignment',kind:'create',requestId:'11111111-1111-4111-8111-111111111111',name:'Area',userId:'rep',polygon});assert.equal(began.status,200);
 const body={id:began.body.id,operationId:began.body.operationId};let queued=0;
 const deps={db:()=>f.db as any,auth:()=>({getUser:async()=>({disabled:false})}) as any,enqueue:async()=>{queued++;}};
 await runTerritoryAssignment(body,deps);assert.equal(f.records.get(`territories/${body.id}`)!.value.assignment.done,true);assert.equal(f.records.get(`territories/${body.id}`)!.value.assignment.changed,450);
 await runTerritoryAssignment(body,deps);assert.equal(queued,0);assert.equal(f.records.get('leads/worked')!.value.assignedTo,'old');assert.equal(f.records.get('leads/worked')!.value.dispositionHistory.length,1);
});
test('worker authentication fails closed',()=>{assert.equal(authorizedTerritoryWorker(null),false);assert.equal(authorizedTerritoryWorker('wrong'),false);});
test('quick save queues the boundary without scanning or assigning leads; enqueue failure remains recoverable',async()=>{
 let attempts=0;
 const f=fixture({ready:()=>true,enqueue:async()=>{attempts++;throw Error('offline task service');}});
 f.seed('users/manager',{name:'Manager',role:'admin',isActive:true});f.seed('users/rep',{name:'Rep',role:'setter',isActive:true,approved:true});
 f.seed('leads/unworked',{lat:43,lng:-77,status:'unclaimed'});
 const polygon=[{lat:42.99,lng:-77.01},{lat:42.99,lng:-76.99},{lat:43.01,lng:-76.99},{lat:43.01,lng:-77.01}];
 const body={action:'save-background-assignment',kind:'create',requestId:'22222222-2222-4222-8222-222222222222',name:'Quick',userId:'rep',polygon};
 const saved=await f.request(body);assert.equal(saved.status,200);assert.equal(saved.body.queued,false);assert.match(saved.body.queueError,/Territory saved/);
 assert.equal(f.records.get(`territories/${saved.body.id}`)!.value.assignment.scanned,0);assert.equal(f.records.get('leads/unworked')!.value.status,'unclaimed');
 const again=await f.request(body);assert.equal(again.status,200);assert.equal([...f.records.keys()].filter(k=>k.startsWith('territories/')).length,1);assert.equal(attempts,2);
 const retry=await f.request({action:'retry-background-assignment',id:saved.body.id});assert.equal(retry.status,200);assert.equal(attempts,3);
});
test('worker persists cursor before continuation failure and resumes without duplicate assignments',async()=>{
 const f=fixture();f.seed('users/manager',{name:'Manager',role:'admin',isActive:true});f.seed('users/rep',{name:'Rep',role:'setter',isActive:true,approved:true});
 const polygon=[{lat:42.99,lng:-77.01},{lat:42.99,lng:-76.99},{lat:43.01,lng:-76.99},{lat:43.01,lng:-77.01}];
 for(let i=0;i<2050;i++)f.seed(`leads/p${i.toString().padStart(4,'0')}`,{lat:43,lng:-77,status:'unclaimed'});
 const began=await f.request({action:'begin-assignment',kind:'create',requestId:'33333333-3333-4333-8333-333333333333',name:'Large',userId:'rep',polygon});
 const body={id:began.body.id,operationId:began.body.operationId};
 const deps={db:()=>f.db as any,auth:()=>({getUser:async()=>({disabled:false})}) as any,enqueue:async()=>{throw Error('Lost queue connection');}};
 await assert.rejects(runTerritoryAssignment(body,deps),/Lost queue/);assert.equal(f.records.get(`territories/${body.id}`)!.value.assignment.changed,2000);
 await runTerritoryAssignment(body,deps);assert.equal(f.records.get(`territories/${body.id}`)!.value.assignment.changed,2050);assert.equal(f.records.get(`territories/${body.id}`)!.value.assignment.done,true);
});
test('disabled manager cannot process a saved assignment',async()=>{
 const f=fixture();f.seed('territories/stopped',{userId:'rep',polygon:[],assignment:{id:'job',actorId:'manager',targetId:'rep',done:false}});
 await assert.rejects(runTerritoryAssignment({id:'stopped',operationId:'job'},{db:()=>f.db as any,auth:()=>({getUser:async()=>({disabled:true})}) as any,enqueue:async()=>{}}),/permissions changed/);
 f.records.delete('territories/stopped');await runTerritoryAssignment({id:'stopped',operationId:'job'},{db:()=>f.db as any,auth:()=>({getUser:async()=>{throw Error('Should not reach Auth');}}) as any,enqueue:async()=>{}});
});
