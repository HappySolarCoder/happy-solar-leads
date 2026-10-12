// Actual exported screens -> real route handlers -> in-memory Firestore adapter.
// All remote traffic is mocked/blocked. Never modifies company records.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {runTerritoryAssignment} from '../../app/utils/server/territoryQueue.ts';
import {fixture} from '../../tests/mobile/helpers/territoryFixture.ts';
import {users,leads} from './fixtures/data.mjs';
const wire=x=>x?.toDate?x.toDate().toISOString():Array.isArray(x)?x.map(wire):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,wire(v)])):x;
const dest='/tmp/raydar-v149-check';await mkdir(dest,{recursive:true});
const server=spawn('python3',['-m','http.server','4218','--bind','127.0.0.1','--directory','/tmp/raydar-ui-audit-out'],{stdio:'ignore'});
let browser,page;const results=[],errors=[];
try{
 for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:4218/mobile/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 for(const device of [{name:'ios',width:393,height:852,top:59,bottom:34},{name:'android',width:360,height:800,top:24,bottom:24}]){
  const tasks=[];const f=fixture({ready:()=>true,enqueue:async(id,operationId)=>{tasks.push({id,operationId});}});for(const u of users())f.seed(`users/${u.id}`,u);
  const poly=(lat,lng)=>[{lat,lng},{lat,lng:lng+.003},{lat:lat+.003,lng:lng+.003},{lat:lat+.003,lng}];
  f.seed('territories/mine',{name:'My area',userId:'audit-user',userName:'Audit User',userColor:'#587E98',polygon:poly(43.163,-77.62),leadIds:[]});
  f.seed('territories/team',{name:'Team area',userId:'audit-rep-1',userName:'Example FMA 1',userColor:'#B28437',polygon:poly(43.17,-77.62),leadIds:[]});
  f.seed('territories/delete.one',{name:'Old area one',userId:'audit-rep-2',userName:'Example FMA 2',polygon:poly(43.18,-77.62),leadIds:[]});
  f.seed('territories/delete.two',{name:'Old area two',userId:'audit-rep-2',userName:'Example FMA 2',polygon:poly(43.185,-77.62),leadIds:[]});
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/tmp/raydar-browser/chromium',args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:device.width,height:device.height},hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'});
  await context.addInitScript(device=>{
    localStorage.setItem('raydar-audit-role',localStorage.getItem('raydar-audit-role')||'admin');localStorage.setItem('raydar_install_dismissed','true');
    window.__gps={lat:43.1566,lng:-77.6088,watchers:new Map(),next:0};
    const position=()=>({coords:{latitude:window.__gps.lat,longitude:window.__gps.lng,accuracy:5},timestamp:Date.now()});
    navigator.geolocation.getCurrentPosition=cb=>cb(position());
    navigator.geolocation.watchPosition=cb=>{const id=++window.__gps.next;window.__gps.watchers.set(id,cb);queueMicrotask(()=>cb(position()));return id;};
    navigator.geolocation.clearWatch=id=>window.__gps.watchers.delete(id);
    window.__gps.move=(lat,lng)=>{window.__gps.lat=lat;window.__gps.lng=lng;for(const cb of window.__gps.watchers.values())cb(position());};
    document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.native=device.name;document.documentElement.style.setProperty('--safe-area-inset-top',device.top+'px');document.documentElement.style.setProperty('--safe-area-inset-bottom',device.bottom+'px');});
  },device);
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(/same key|duplicate key|React error|Maximum update depth/i.test(msg.text()))errors.push(msg.text());});
  const calls=[];let deletionFailed=false;
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.pathname.startsWith('/api/')){
      if(u.pathname==='/api/territory-management'){
        const body=route.request().method()==='POST'?route.request().postDataJSON():undefined;calls.push(body||{action:'GET'});
        if(body?.action==='archive'&&body.id==='delete.one'&&!deletionFailed){deletionFailed=true;return route.fulfill({status:503,json:{error:'Temporary test interruption'}});}
        const r=await f.request(body,'audit-user');return route.fulfill({status:r.status,json:r.body});
      }
      if(u.pathname==='/api/mobile-leads')return route.fulfill({json:{leads:wire(leads()),nextCursor:null}});
      if(u.pathname==='/api/team-areas')return route.fulfill({json:{territories:[...f.records].filter(([p])=>p.startsWith('territories/')).map(([p,d])=>({id:p.split('/')[1],...d.value})),members:[]}});
      return route.fulfill({json:u.pathname.includes('historical')?{pins:[]}:u.pathname.includes('goals')?{doorKnocksGoal:null}:{}});
    }
    if(u.hostname==='127.0.0.1')return route.continue();
    if(/arcgisonline.com|openstreetmap.org/.test(u.hostname))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e5ebdf"/><path d="M0 128h256M128 0v256" stroke="white" stroke-width="12"/><text x="8" y="24">TEST MAP</text></svg>'});
    return route.abort();
  });
  const go=path=>page.goto('http://127.0.0.1:4218'+path);
  const centered=()=>page.evaluate(()=>{const m=document.querySelector('.rm-knocking-map .leaflet-container')?.getBoundingClientRect(),p=document.querySelector('.user-location-marker')?.getBoundingClientRect();return m&&p?Math.hypot(p.x+p.width/2-m.x-m.width/2,p.y+p.height/2-m.y-m.height/2):9999;});
  await go('/mobile/knocking/');await expect(page.getByRole('button',{name:'Search address',exact:true})).toBeVisible();await expect.poll(centered).toBeLessThan(3);
  assert.equal(await page.locator('.rm-search-icon').evaluate(e=>Math.round(e.getBoundingClientRect().width)),44);
  const toolbar=page.locator('.rm-field-toolbar');
  await expect(toolbar.getByRole('link',{name:'Open account and tools'})).toHaveText('AU');
  assert.equal(await toolbar.locator('.rm-gps').count(),0);
  const boxes=await toolbar.locator('.rm-search-icon,.rm-knock-counter,.rm-areas-toggle,.rm-filter,.rm-toolbar-account').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}));
  assert.ok(boxes.every(b=>b.h===44&&b.y===boxes[0].y),'toolbar controls share height and baseline');
  assert.ok(boxes.every((b,i)=>!i||b.x>=boxes[i-1].x+boxes[i-1].w+5),'toolbar controls have breathing room');
  const locate=await page.locator('.rm-map-locate').boundingBox(),focus=await page.locator('.rm-door-actions').boundingBox();
  assert.ok(locate.x>device.width/2 && Math.abs((locate.y+locate.height/2)-(focus.y+focus.height/2))<3 && focus.x+focus.width<=locate.x-6,'GPS aligns with centered Focus without covering it');
  await page.screenshot({path:`${dest}/${device.name}-toolbar.png`});
  await expect(page.locator('.territory-label')).toHaveCount(1);
  await page.getByRole('button',{name:'Areas',exact:true}).click();await page.getByRole('button',{name:'Team territories',exact:true}).click();await expect(page.locator('.territory-label')).toHaveCount(4);
  await page.getByRole('button',{name:'Areas',exact:true}).click();await page.getByRole('button',{name:'Off',exact:true}).click();await expect(page.locator('.territory-label')).toHaveCount(0);
  await page.getByRole('button',{name:'Areas',exact:true}).click();await page.getByRole('button',{name:'Zoom to mine',exact:true}).click();await expect(page.locator('.territory-label')).toHaveCount(1);
  await expect.poll(centered).toBeGreaterThan(30);
  await page.getByRole('button',{name:/^Center map on my location/}).click();await expect.poll(centered).toBeLessThan(3);
  const map=await page.locator('.rm-knocking-map .leaflet-container').boundingBox();
  await page.mouse.move(map.x+map.width*.65,map.y+map.height*.5);await page.mouse.down();await page.mouse.move(map.x+map.width*.35,map.y+map.height*.5,{steps:10});await page.mouse.up();
  await expect.poll(centered).toBeGreaterThan(25);
  await page.evaluate(()=>window.__gps.move(43.15661,-77.60881));await expect.poll(centered).toBeGreaterThan(25);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));window.__gps.lat=43.1568;Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(centered).toBeLessThan(3);
  await page.getByRole('button',{name:/Open Focus/}).click();await page.getByLabel('Door goal').fill('60');await page.getByRole('button',{name:'3 appointments',exact:true}).click();await page.getByRole('button',{name:'Start focus session',exact:true}).click();await page.getByRole('button',{name:'Back to the doors'}).click();
  await expect(page.getByRole('button',{name:/Open Focus/})).toContainText('0/60 doors');await expect(page.getByRole('button',{name:/Open Focus/})).toContainText('0/3 set');
  await page.reload();await expect(page.getByRole('button',{name:/Open Focus/})).toContainText('0/3 set');
  await page.getByRole('button',{name:/Open Focus/}).click();await page.getByRole('button',{name:'Edit goals'}).click();await page.getByLabel('Door goal').fill('100');await page.getByRole('button',{name:'5 appointments',exact:true}).click();await page.getByRole('button',{name:'Save goals'}).click();await page.getByRole('button',{name:'Back to the doors'}).click();await expect(page.getByRole('button',{name:/Open Focus/})).toContainText('0/5 set');
  await page.getByRole('button',{name:'Search address',exact:true}).click();await expect(page.getByRole('textbox',{name:'Search address'})).toBeVisible();await page.getByTitle('Close',{exact:true}).click();
  await page.getByRole('button',{name:/^Filters/}).click();await expect(page.getByText('Solar Score Filter')).toHaveCount(0);
  await page.getByRole('button',{name:'Last 7 days',exact:true}).click();await page.getByRole('button',{name:'Not Home',exact:true}).click();await page.getByRole('button',{name:'Not Interested',exact:true}).click();
  await expect(page.getByRole('button',{name:'Last 7 days',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('button',{name:'Not Home',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('button',{name:'Not Interested',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.screenshot({path:`${dest}/${device.name}-filters.png`});await page.getByRole('button',{name:'Show map',exact:true}).click();await expect(page.getByRole('button',{name:'Filters, 2 active'})).toBeVisible();
  await page.screenshot({path:`${dest}/${device.name}-map.png`});
  await page.evaluate(()=>localStorage.setItem('raydar-audit-role','setter'));await page.reload();await expect.poll(centered).toBeLessThan(3);
  await page.evaluate(()=>localStorage.setItem('raydar-audit-role','admin'));
  await go('/mobile/territories/');await expect(page.getByRole('heading',{name:'Territories',exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^Choose territory user:/}).click();await page.getByLabel('Search users').fill('Example FMA 2');await page.getByRole('button',{name:'Select Example FMA 2',exact:true}).click();
  await page.getByRole('button',{name:'Delete all territories',exact:true}).click();const deletion=page.getByRole('dialog',{name:'Delete all territories'});
  await deletion.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(calls.filter(c=>c.action==='archive').length,0);
  await page.getByRole('button',{name:'Delete all territories',exact:true}).click();await deletion.getByRole('button',{name:'Delete all territories',exact:true}).click();await expect(deletion.getByRole('alert')).toContainText('Temporary test interruption');
  assert.equal(f.records.has('territories/delete.two'),false);assert.equal(f.records.has('territories/delete.one'),true);
  await deletion.getByRole('button',{name:'Delete all territories',exact:true}).click();await expect(deletion).toHaveCount(0);assert.equal(f.records.has('territories/delete.one'),false);assert.equal(f.records.has('territories/team'),true);
  // Move to an empty test region after verifying the other user's boundary survived.
  f.records.delete('territories/mine');f.records.delete('territories/team');await page.getByRole('button',{name:'Refresh territories'}).click();
  // Real handlers through the actual create/review/assign UI, >400 pins.
  await page.getByRole('button',{name:'New area',exact:true}).click();
  const tm=await page.locator('.rt-map').boundingBox();
  await page.touchscreen.tap(tm.x+tm.width*.30,tm.y+tm.height*.32);await page.touchscreen.tap(tm.x+tm.width*.75,tm.y+tm.height*.49);
  await expect(page.locator('.rt-edit-corner')).toHaveCount(4);
  assert.ok((await page.locator('.rt-edit-corner').allTextContents()).every(text=>!text.trim()),'drawing handles are unnumbered');
  await page.getByLabel('Territory name').fill('Large test assignment');
  // An old server must not silently reintroduce the size-limited review.
  await page.route('**/api/territory-management?summary=1',async route=>{const result=await f.request(undefined,'audit-user');delete result.body.capabilities;return route.fulfill({status:200,json:result.body});});
  const beforeReview=calls.filter(c=>c.action==='preview').length;
  await page.getByRole('button',{name:'Save territory',exact:true}).click();
  await expect(page.locator('.rt-alert')).toContainText('v14.9 backend setup');
  assert.equal(calls.filter(c=>c.action==='preview').length,beforeReview);
  await expect(page.locator('.rt-edit-corner')).toHaveCount(4);
  await page.unroute('**/api/territory-management?summary=1');
  // Read the drawn geographic outline from the preview request, then seed the
  // fixture before the real preview handler runs.
  await page.route('**/api/territory-management',async(route)=>{
    const b=route.request().method()==='POST'?route.request().postDataJSON():null;
    if(b?.action==='save-background-assignment'&&b.kind==='create'){const lat=b.polygon.reduce((s,p)=>s+p.lat,0)/b.polygon.length,lng=b.polygon.reduce((s,p)=>s+p.lng,0)/b.polygon.length;for(let i=0;i<450;i++)f.seed(`leads/test-${i}`,{lat,lng,status:'unclaimed',notes:'Preserve'});}
    return route.fallback();
  });
  await page.getByRole('button',{name:'Save territory',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Territory saved.'})).toBeVisible();
  assert.equal(calls.filter(c=>c.action==='preview-v2'||c.action==='continue-assignment').length,0);
  assert.equal(f.records.get('leads/test-0').value.status,'unclaimed');
  // Close/remount the screen before the server worker runs. No app continuation.
  await go('/mobile/');
  for(const task of tasks.splice(0))await runTerritoryAssignment(task,{db:()=>f.db,auth:()=>({getUser:async()=>({disabled:false})}),enqueue:async(id,operationId)=>tasks.push({id,operationId})});
  await go('/mobile/territories/');await page.getByRole('button',{name:/Large test assignment/}).click();
  await expect(page.getByRole('button',{name:'Rename',exact:true})).toBeVisible();await page.getByRole('button',{name:'Rename',exact:true}).click();const rename=page.getByRole('dialog',{name:'Rename territory'});await rename.getByRole('textbox').fill('Renamed test area');await rename.getByRole('button',{name:'Save name',exact:true}).click();
  await page.getByRole('button',{name:'Transfer',exact:true}).click();const transfer=page.getByRole('dialog',{name:'Transfer this area'});await transfer.getByRole('button',{name:/^New rep:/}).click();await page.getByLabel('Search users').fill('Example FMA 1');await page.getByRole('button',{name:'Select Example FMA 1',exact:true}).click();await transfer.getByRole('button',{name:'Transfer area',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Territory saved.'})).toBeVisible();for(const task of tasks.splice(0))await runTerritoryAssignment(task,{db:()=>f.db,auth:()=>({getUser:async()=>({disabled:false})}),enqueue:async()=>{}});assert.equal(f.records.get('leads/test-0').value.assignedTo,'audit-rep-1');assert.equal(f.records.get('leads/test-0').value.notes,'Preserve');
  await page.screenshot({path:`${dest}/${device.name}-territories.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  results.push({device:device.name,focusGoalsAndPersistence:true,dateDispositionFilters:true,myTeamOffAndZoom:true,gpsStartupPanAndResume:true,create450RenameTransfer:true,partialDeleteAndRetry:true,alignedToolbarAndAccount:true,gpsBottomRight:true,unnumberedHandles:true,missingCompanionExplained:true,productionWrites:0});
  await browser.close();browser=null;
 }
 assert.deepEqual(errors,[]);await writeFile(`${dest}/results.json`,JSON.stringify({results,errors},null,2));console.log(JSON.stringify(results));
}catch(e){await page?.screenshot({path:`${dest}/failure.png`}).catch(()=>{});console.error(e);throw e;}finally{await browser?.close();server.kill();}
