import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { createMobileLeadHandler } from '../../app/utils/server/mobileLeads';
import { fixture } from './helpers/territoryFixture';
import { inPinScope, scopedViews } from '../../app/mobile/_lib/pinScope';
import { validateTerritoryPolygon } from '../../app/utils/territoryManager';
import { applyRead, hashNumber, numberHash, missingRanges, type Homeowner, type HomeTile } from '../../app/homeowners/model';
const polygon=[{lat:43,lng:-77},{lat:43,lng:-76.99},{lat:43.01,lng:-76.99},{lat:43.01,lng:-77}];
const view={south:42.999,north:43.011,west:-77.001,east:-76.989,zoom:17};
const url='https://test.invalid/api/mobile-leads?mode=map&'+new URLSearchParams(Object.fromEntries(Object.entries(view).map(([k,v])=>[k,String(v)])));
function api(){const f=fixture();const get=createMobileLeadHandler({adminDb:()=>f.db,adminAuth:()=>({verifyIdToken:async(token:string)=>{if(token==='bad')throw Object.assign(Error(),{code:'auth/id-token-revoked'});return {uid:token};}})} as any);return {...f,call:async(user:string,href=url)=>{const r=await get(new NextRequest(href,{headers:{Authorization:`Bearer ${user}`}}));return {status:r.status,body:await r.json()};}};}
test('territory scope clips queries and includes boundary points without exposing outside homes',()=>{
 assert.equal(inPinScope(43.005,-76.995,[polygon]),true);assert.equal(inPinScope(43,-77,[polygon]),true);assert.equal(inPinScope(43.005,-76.98,[polygon]),false);assert.equal(inPinScope(43,-77,[]),false);assert.equal(inPinScope(43,-77,undefined),true);
 assert.deepEqual(scopedViews(view,[polygon])[0],{...view,south:43,north:43.01,west:-77,east:-76.99,polygons:undefined});
 assert.equal(scopedViews({...view,south:44,north:44.01},[polygon]).length,0);
});
test('map server enforces rep territories, allows admin/manager browsing, and never changes a lead',async()=>{
 const f=api();f.seed('territories/mine',{userId:'rep',polygon});f.seed('leads/inside',{lat:43.005,lng:-76.995,status:'not-home',assignedTo:'next',dispositionHistory:[{userId:'next',timestamp:new Date(),disposition:'Not Home'}]});f.seed('leads/outside',{lat:43.005,lng:-76.9895,status:'assigned'});
 const before=structuredClone([...f.records]);
 assert.deepEqual((await f.call('rep')).body.leads.map((l:any)=>l.id),['inside']);
 for(const role of ['admin','manager'])assert.equal((await f.call(role)).body.leads.length,2);
 assert.equal((await f.call('outsider')).body.leads.length,0);
 assert.deepEqual([...f.records],before);
 f.seed('users/rep',{role:'setter',isActive:false});assert.equal((await f.call('rep')).status,403);assert.equal((await f.call('bad')).status,401);
});
test('map rejects broad scans and pages only 500 records, with stable equal-latitude cursors',async()=>{
 const f=api();for(let i=0;i<620;i++)f.seed(`leads/p${String(i).padStart(4,'0')}`,{lat:43.005,lng:-76.995,status:'assigned'});
 const first=await f.call('admin');assert.equal(first.body.scanned,500);assert.equal(first.body.leads.length,500);
 const second=await f.call('admin',url+`&after=${first.body.nextCursor.id}&afterLat=${first.body.nextCursor.lat}`);assert.equal(second.body.leads.length,120);assert.equal(second.body.nextCursor,null);
 assert.equal(new Set([...first.body.leads,...second.body.leads].map(l=>l.id)).size,620);
 assert.equal((await f.call('admin',url.replace('north=43.011','north=44'))).status,400);
});
test('personal payload excludes unworked bulk assignments and keeps owned follow-ups',async()=>{
 const f=api();f.seed('leads/unworked',{assignedTo:'rep',status:'assigned'});f.seed('leads/old-reminder',{assignedTo:'rep',status:'go-back',goBackScheduledBy:'rep',goBackScheduledDate:new Date('2025-01-01')});f.seed('leads/recent',{assignedTo:'rep',status:'not-home',dispositionedAt:new Date(),dispositionHistory:Array.from({length:40},()=>({userId:'rep',timestamp:new Date(),disposition:'Not Home'}))});
 const r=await f.call('rep','https://test.invalid/api/mobile-leads?mode=personal&field=assignedTo');
 assert.deepEqual(r.body.leads.map((l:any)=>l.id),['old-reminder','recent']);assert.equal(r.body.leads[1].dispositionHistory.length,40);assert.equal((await f.call('rep','https://test.invalid/api/mobile-leads?mode=personal&field=recent')).status,400);
});
test('moving a square corner outward remains valid; true crossings are still rejected',()=>{
 const changed=polygon.map((p,i)=>i===2?{lat:p.lat+.005,lng:p.lng+.004}:p);
 assert.deepEqual(validateTerritoryPolygon(changed),changed);
 assert.throws(()=>validateTerritoryPolygon([polygon[0],polygon[2],polygon[1],polygon[3]]),/cross/);
});
test('dense homeowner ranges advance without discarding the shared final hash or claiming false coverage',()=>{
 const lo=hashNumber('dr8v00000'),range={lo,hi:lo+1000};const tile:HomeTile={tile:'dr8v0',docs:{},receipts:[],touched:0};
 const docs=Array.from({length:500},(_,i)=>({id:`h${i}`,geohash:numberHash(lo+i),geohash5:'dr8v0',lat:43,lng:-77} as Homeowner));
 const saved=applyRead(tile,range,docs,500,17);const missing=missingRanges(saved,[range],17);
 assert.deepEqual(missing.ranges,[{lo:lo+499,hi:lo+1000}]);assert.equal(Object.keys(saved.docs).length,500);
});
test('both iOS launch paths register the custom dictation bridge',()=>{
 assert.match(readFileSync('ios/App/App/SceneDelegate.swift','utf8'),/rootViewController = RaydarViewController\(\)/);
 assert.match(readFileSync('ios/App/App/Base.lproj/Main.storyboard','utf8'),/customClass="RaydarViewController"/);
 assert.match(readFileSync('ios/App/App/RaydarViewController.swift','utf8'),/registerPluginInstance\(RaydarDictationPlugin\(\)\)/);
});

test('Focus and return reminder have distinct identities during location and data updates',()=>{
 const source=readFileSync('app/mobile/knocking/page.tsx','utf8');
 assert.match(source,/<DoorCoach key=\{`focus:/);assert.match(source,/<ReturnVisitReminder key=\{`reminder:/);
});

test('feedback rejects invalid ownership and type, saves once on retry, and restricts team review to admin',async()=>{
 const {createFeedbackHandlers}=await import('../../app/utils/server/mobileFeedback');
 const f=fixture(),files=new Map<string,any>();
 const handlers=createFeedbackHandlers({db:()=>f.db,auth:()=>({verifyIdToken:async(uid:string)=>({uid})}),bucket:()=>({file:(name:string)=>({save:async(bytes:Buffer,options:any)=>{if(files.has(name))throw {code:412};files.set(name,{bytes,options});}}),getFiles:async()=>[[...files].map(([name,value])=>({name,metadata:{metadata:value.options.metadata.metadata,size:value.bytes.length},getSignedUrl:async()=>['https://example.invalid/audio']})),null]})} as any);
 const payload={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',uid:'rep',createdAt:new Date().toISOString(),audio:Buffer.from('synthetic audio').toString('base64'),mime:'audio/webm',note:'A fictional issue',platform:'ios',version:'14.8'};
 const post=(body:any,uid='rep')=>handlers.POST(new NextRequest('https://test.invalid/api/mobile-feedback',{method:'POST',headers:{Authorization:`Bearer ${uid}`},body:JSON.stringify(body)}));
 assert.equal((await post({...payload,uid:'next'})).status,400);assert.equal((await post({...payload,mime:'text/html'})).status,400);assert.equal(files.size,0);
 assert.equal((await post(payload)).status,200);assert.equal((await post(payload)).status,200);assert.equal(files.size,1);
 const stored=[...files][0];assert.ok(stored[0].startsWith('raydar-feedback/rep/'));assert.equal(stored[1].options.preconditionOpts.ifGenerationMatch,0);assert.equal(stored[1].options.metadata.metadata.uid,'rep');
 const read=(uid:string)=>handlers.GET(new NextRequest('https://test.invalid/api/mobile-feedback?all=1',{headers:{Authorization:`Bearer ${uid}`}}));
 assert.equal((await read('rep')).status,403);assert.equal((await read('admin')).status,200);
});
