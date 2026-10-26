// Actual Knock-page verification with a synthetic Firebase adapter. No live data or webhooks.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const dest='/tmp/raydar-v126-check';await mkdir(dest,{recursive:true});
const server=spawn('python',['-m','http.server','4206','--bind','127.0.0.1','--directory','/tmp/raydar-ui-audit-out'],{stdio:'ignore'});let browser,page;
const errors=[],forbidden=[],hooks=[];let loseAck=false,creates=0;
try{
 for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:4206/mobile/knocking/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 browser=await chromium.launch({executablePath:'/tmp/raydar-browser/chromium',args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,deviceScaleFactor:2,timezoneId:'America/Phoenix',permissions:['geolocation'],serviceWorkers:'block',reducedMotion:'reduce'});
 await context.addInitScript(()=>{
  localStorage.setItem('raydar-audit-role','setter');localStorage.setItem('raydar_install_dismissed','true');
  window.__raydarWriteTest=JSON.parse(localStorage.getItem('raydar-fixture-backend')||'{"leads":{},"writes":[],"reads":[],"fail":false}');
  Object.defineProperty(navigator,'onLine',{get:()=>localStorage.getItem('raydar-fixture-offline')!=='1'});
  navigator.geolocation.getCurrentPosition=success=>success({coords:{latitude:43.1566,longitude:-77.6088,accuracy:5},timestamp:Date.now()});
 });
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{errors.push(d.message());console.log('DIALOG',d.message());await d.dismiss();});
 await page.route('**/*',async r=>{
  const u=new URL(r.request().url());
  if(u.hostname==='firestore.googleapis.com'){
   assert.equal(u.pathname,'/v1/projects/fixture/databases/(default)/documents:commit');
   assert.equal(await page.evaluate(()=>navigator.onLine),true,'no request while offline');
   creates++;const result=await page.evaluate(p=>window.__raydarFixtureRestCommit(p),r.request().postDataJSON());
   if(loseAck&&result.status===200){loseAck=false;return r.fulfill({status:503,json:{error:{status:'UNAVAILABLE'}}});}
   return r.fulfill(result);
  }
  if(u.pathname.startsWith('/api/')){
   if(/field-work|field-config|field-recovery|mobile-user-management/.test(u.pathname))forbidden.push(u.pathname);
   let json={};if(u.pathname.includes('weather'))json={temperature:70,condition:'Clear',hourly:[]};else if(u.pathname.includes('historical'))json={pins:[]};else if(u.pathname.includes('team-area'))json={territories:[],members:[]};else if(u.pathname.includes('solar-madness'))json={enabled:false,awarded:false};return r.fulfill({json});
  }
  if(u.hostname==='fixture.example.invalid'){hooks.push(r.request().postDataJSON());return r.fulfill({status:204});}
  if(u.hostname==='127.0.0.1')return r.continue();
  if(/arcgisonline.com|openstreetmap.org/.test(u.hostname))return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#bcc7ae"/><path d="M0 128h256M128 0v256" stroke="#737b7d" stroke-width="20"/><g fill="#d9d4c3" stroke="#706a60"><rect x="20" y="25" width="55" height="45"/><rect x="175" y="25" width="55" height="45"/><rect x="20" y="180" width="55" height="45"/><rect x="175" y="180" width="55" height="45"/></g></svg>'});return r.abort();
 });
 const writes=()=>page.evaluate(()=>window.__raydarWriteTest.writes);
 const drafts=()=>page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('raydar-field-v11');r.onsuccess=()=>{const db=r.result,q=db.transaction('drafts').objectStore('drafts').getAll();q.onsuccess=()=>{resolve(q.result);db.close();};q.onerror=reject;};r.onerror=reject;}));
 const openHome=async address=>{await page.getByRole('button',{name:/Open homeowner list/}).click();await page.getByLabel('Find a home').fill(address);await page.locator('.rh-list-row').first().click();await expect(page.getByRole('button',{name:'Close lead details'})).toBeVisible();};
 const close=()=>page.getByRole('button',{name:'Close lead details'}).click();
 const empty=()=>expect.poll(async()=>(await drafts()).length,{timeout:20000}).toBe(0);
 const offline=async value=>page.evaluate(value=>{localStorage.setItem('raydar-fixture-offline',value?'1':'0');window.dispatchEvent(new Event(value?'offline':'online'));},value);
 const stampMs=v=>{assert.equal(typeof v.seconds,'number');assert.equal(typeof v.nanoseconds,'number');return v.seconds*1000+v.nanoseconds/1000000;};
 const verify=(w,status)=>{
  const d=w.data,h=d.dispositionHistory[0];assert.equal(d.status,status);assert.equal(h.userId,'audit-user');assert.equal(h.userName,'Audit User');assert.equal(stampMs(d.dispositionedAt),stampMs(h.timestamp));
  assert.equal(d.knockGpsLat,43.1566);assert.equal(d.knockGpsLng,-77.6088);assert.equal(d.knockGpsAccuracy,5);assert.ok(stampMs(d.knockGpsTimestamp)>0);assert.equal(typeof d.knockDistanceFromAddress,'number');
  if(w.kind==='update')for(const k of ['claimedBy','claimedAt','setterId','assignedTo','territoryId'])assert.equal(k in d,false,`ownership omitted: ${k}`);
 };
 await page.goto('http://127.0.0.1:4206/mobile/knocking/');await expect(page.locator('.raydar-homeowner-canvas')).toHaveCount(1);
 await openHome('814 Test Roof');assert.equal((await writes()).length,0);
 await page.getByRole('button',{name:'NH — Not Home',exact:true}).click();await expect.poll(async()=>(await writes()).length).toBe(1);await empty();verify((await writes())[0],'not-home');
 for(const [name,id] of [['Interested','interested'],['Appointment','appointment'],['Sale!','sale'],['House for Sale','house-for-sale']]){
  const n=(await writes()).length;await page.getByRole('button',{name,exact:true}).click();if(id==='house-for-sale'){await page.locator('input[type=date]').fill('2026-12-01');await page.getByRole('button',{name:'Schedule House for Sale',exact:true}).click();}await expect.poll(async()=>(await writes()).length).toBe(n+1);await empty();verify((await writes()).at(-1),id);
 }
 await page.getByRole('button',{name:'NI — Not Interested',exact:true}).click();await page.getByRole('button',{name:/Cost|Expensive/}).first().click();await page.getByPlaceholder(/Any specific details/).fill('Fictional price objection');await page.getByRole('button',{name:'Save Objection',exact:true}).click();await expect.poll(async()=>(await writes()).length).toBe(6);await empty();verify((await writes()).at(-1),'not-interested');assert.equal((await writes()).at(-1).data.objectionRecordedBy,'audit-user');assert.equal((await writes()).at(-1).data.objectionNotes,'Fictional price objection');
 await page.getByRole('button',{name:'GB — Go Back',exact:true}).click();await page.locator('input[type=date]').fill('2026-12-01');await page.locator('input[type=time]').fill('14:30');await page.getByPlaceholder('Add any notes about this go back...').fill('Meet owner after lunch');await page.getByRole('button',{name:'Schedule Go Back',exact:true}).click();await expect.poll(async()=>(await writes()).length).toBe(7);await empty();verify((await writes()).at(-1),'go-back');assert.equal((await writes()).at(-1).data.goBackScheduledTime,'14:30');stampMs((await writes()).at(-1).data.goBackScheduledDate);await close();
 // Offline capture survives a full document reload; local fixture server remains reachable.
 await openHome('815 Test Roof');await offline(true);await page.getByRole('button',{name:'NH — Not Home',exact:true}).click();await expect(page.locator('.rm-unsynced')).toHaveCount(0);assert.equal((await writes()).length,7);const knockAt=(await drafts())[0].createdAt;
 await page.reload();await expect(page.locator('.rm-unsynced')).toHaveCount(0);assert.equal((await writes()).length,7);await page.screenshot({path:`${dest}/offline-unsynced.png`});await offline(false);await expect.poll(async()=>(await writes()).length).toBe(8);await empty();verify((await writes()).at(-1),'not-home');assert.equal(stampMs((await writes()).at(-1).data.dispositionedAt),new Date(knockAt).getTime());
 // Server created the lead, but acknowledgement was lost. Retry must not overwrite or duplicate.
 await openHome('816 Test Roof');loseAck=true;await page.getByRole('button',{name:'NH — Not Home',exact:true}).click();await expect(page.locator('.rm-unsynced')).toHaveCount(0);await expect(page.getByRole('button',{name:'Retry sync',exact:true})).toHaveCount(0);await expect.poll(async()=>(await writes()).length).toBe(9);await empty();assert.equal((await writes()).length,9);await close();
 // Scheduling payload and save-before-send ordering match the production web contract.
 await openHome('817 Test Roof');await page.getByRole('button',{name:'CSM — Call Scheduling Manager',exact:true}).click();await expect(page.getByRole('heading',{name:'Scheduling Manager'})).toBeVisible();const form=page.locator('div.pointer-events-auto').filter({has:page.getByRole('heading',{name:'Scheduling Manager'})});await form.locator('input').nth(4).fill('14620');await form.locator('input[type=tel]').fill('5555550199');await page.getByRole('button',{name:'Send Info to Scheduling Manager'}).click();await expect(page.getByRole('link',{name:'Call Scheduling Manager',exact:true})).toHaveAttribute('href','tel:5555550101');assert.equal(hooks.length,1);assert.deepEqual(Object.keys(hooks[0]),['content']);assert.match(hooks[0].content,/Sent by:\*\* Audit User/);assert.match(hooks[0].content,/Fictional Owner 17/);assert.match(hooks[0].content,/Notes: None\n\n🎯/);await empty();assert.equal((await writes()).at(-1).data.phone,'5555550199');assert.notEqual((await writes()).at(-1).data.status,'appointment');
 await page.getByRole('button',{name:'Close',exact:true}).click();await close();
 // The same claim/unclaim helpers clear ownership only on explicit actions.
 await openHome('814 Test Roof');const beforeClaim=(await writes()).length;await page.getByRole('button',{name:'Unclaim',exact:true}).click();await expect.poll(async()=>(await writes()).length).toBe(beforeClaim+1);let claimWrite=(await writes()).at(-1);assert.equal(claimWrite.data.status,'unclaimed');assert.deepEqual(claimWrite.data.claimedBy,{auditDelete:true});assert.equal('dispositionHistory'in claimWrite.data,false);await expect(page.getByRole('button',{name:'Close lead details'})).toHaveCount(0);await openHome('814 Test Roof');await expect(page.getByRole('button',{name:'Claim',exact:true})).toBeVisible();await page.getByRole('button',{name:'Claim',exact:true}).click();await expect.poll(async()=>(await writes()).length).toBe(beforeClaim+2);claimWrite=(await writes()).at(-1);assert.equal(claimWrite.data.claimedBy,'audit-user');assert.equal('dispositionHistory'in claimWrite.data,false);await close();
 await page.screenshot({path:`${dest}/compact-pins.png`});
  const pinImages=await page.locator('.field-pin img').evaluateAll(imgs=>imgs.map(i=>({w:i.getBoundingClientRect().width,h:i.getBoundingClientRect().height,expected:Number(i.getAttribute('width'))})));assert.ok(pinImages.length);assert.ok(pinImages.every(i=>i.w<=14&&i.h<=14&&Math.abs(i.w-i.expected)<.1),'rendered pins match compact dimensions despite Leaflet CSS');
 for(const size of [{width:360,height:800},{width:768,height:1024}]){await page.setViewportSize(size);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);}
 assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[]);assert.ok((await writes()).every(w=>w.path.startsWith('leads/')));
 await writeFile(`${dest}/results.json`,JSON.stringify({commonDispositions:7,typedTimestamps:true,repIdentityAndGps:true,ownershipUnchangedOnUpdate:true,offlineReloadAutoSync:true,originalKnockTime:true,lostAcknowledgementRetryWithoutDuplicate:true,visibleUnsyncedCount:true,schedulerPayloadAndSaveBeforeSend:true,explicitClaimUnclaim:true,compactNeighborhoodPins:true,forbiddenApiRequests:forbidden,liveWrites:0,fixtureWrites:(await writes()).length,createAttempts:creates,errors},null,2));console.log('v12.6 actual Knock-page checks passed; only isolated fixtures were written.');
}catch(e){if(page){await page.screenshot({path:`${dest}/failure.png`});console.error((await page.locator('body').innerText()).slice(-5000));console.error('ERRORS',errors);console.error('PIN SIZES',await page.locator('.field-pin img').evaluateAll(imgs=>imgs.slice(0,3).map(i=>({width:i.width,attr:i.getAttribute('width'),height:i.height,style:i.getAttribute('style'),css:getComputedStyle(i).cssText,computedWidth:getComputedStyle(i).width,computedHeight:getComputedStyle(i).height}))));console.error('STATE',await page.evaluate(()=>window.__raydarWriteTest.writes.slice(-1)));}throw e;}finally{await browser?.close();server.kill();}
