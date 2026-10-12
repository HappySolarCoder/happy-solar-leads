import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {leads} from './fixtures/data.mjs';
const dest='/tmp/raydar-v148-stability';await mkdir(dest,{recursive:true});
const server=spawn('python3',['-m','http.server','4228','--bind','127.0.0.1','--directory','/tmp/raydar-ui-audit-out'],{stdio:'ignore'});
const wire=x=>x?.toDate?x.toDate().toISOString():Array.isArray(x)?x.map(wire):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,wire(v)])):x;
const own=[{lat:43.15,lng:-77.612},{lat:43.15,lng:-77.6},{lat:43.16,lng:-77.6},{lat:43.16,lng:-77.612}];
let browser,page;const results=[],errors=[];
try{
 for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:4228/mobile/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 for(const role of ['admin','manager','setter']){
 browser=await chromium.launch({executablePath:'/tmp/raydar-browser/chromium',args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});

  const context=await browser.newContext({viewport:{width:375,height:667},hasTouch:true,permissions:['microphone'],serviceWorkers:'block',reducedMotion:'reduce'});
  await context.addInitScript(role=>{
   localStorage.setItem('raydar-audit-role',role);localStorage.setItem('raydar_install_dismissed','true');
   window.__watches=new Map();window.__watchId=0;window.__gpsDenied=false;
   const pos=()=>({coords:{latitude:43.1566,longitude:-77.6088,accuracy:5},timestamp:Date.now()});
   navigator.geolocation.getCurrentPosition=(ok,fail)=>window.__gpsDenied?fail({code:1,message:'Denied'}):ok(pos());
   navigator.geolocation.watchPosition=(ok,fail)=>{const id=++window.__watchId;window.__watches.set(id,ok);queueMicrotask(()=>window.__gpsDenied?fail({code:1,message:'Denied'}):ok(pos()));return id;};navigator.geolocation.clearWatch=id=>window.__watches.delete(id);
   window.__pulse=()=>{for(const ok of window.__watches.values())ok(pos());};
  },role);
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/same key|duplicate key|Maximum update depth|Minified React error/i.test(m.text()))errors.push(m.text());});
  let personalCalls=0,mapCalls=0,voiceFail=true;const uploaded=[];
  await page.route('**/*',async r=>{
   const u=new URL(r.request().url());
   if(u.pathname==='/api/mobile-leads'){if(u.searchParams.get('mode')==='personal')personalCalls++;else mapCalls++;return r.fulfill({json:{leads:wire(leads()),nextCursor:null}});}
   if(u.pathname==='/api/team-areas')return r.fulfill({json:{territories:[{id:'mine',userId:'audit-user',userName:'Audit User',polygon:own,leadIds:[]}],members:[]}});
   if(u.pathname==='/api/mobile-feedback'){
    if(r.request().method()==='POST'){if(voiceFail)return r.fulfill({status:503,json:{error:'Synthetic offline service'}});const data=r.request().postDataJSON();uploaded.push(data);return r.fulfill({json:{saved:true,id:data.id}});}
    return r.fulfill({json:{items:[],cursor:null}});
   }
   if(u.pathname.startsWith('/api/'))return r.fulfill({json:u.pathname.includes('historical')?{pins:[]}:u.pathname.includes('goals')?{doorKnocksGoal:null}:{}});
   if(u.hostname==='127.0.0.1')return r.continue();
   if(/arcgisonline.com|openstreetmap.org/.test(u.hostname))return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e5ebdf"/></svg>'});
   return r.abort();
  });
  await page.goto('http://127.0.0.1:4228/mobile/knocking/');await expect(page.locator('.rm-door-actions')).toHaveCount(1);
  const cdp=await context.newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');const initial=(await cdp.send('Runtime.getHeapUsage')).usedSize;
  for(let cycle=0;cycle<12;cycle++){
   await page.evaluate(()=>{for(let i=0;i<15;i++)window.__pulse();});
   for(const href of ['/mobile','/mobile/follow-ups','/mobile/stats']){
    await page.getByRole("navigation",{name:"Main navigation"}).getByRole("link",{name:({"/mobile":"Today","/mobile/follow-ups":"Follow-ups","/mobile/stats":"Progress"})[href],exact:true}).click();await expect(page.locator('.rm-nav')).toHaveCount(1);await expect.poll(()=>page.evaluate(()=>window.__watches.size)).toBe(0);
    assert.equal(await page.locator('.rm-knocking-map').count(),0);
   }
   await page.getByRole('link',{name:'Open account and tools'}).click();await expect(page.getByRole('button',{name:/Send voice feedback/})).toBeVisible();
   await page.getByRole("navigation",{name:"Main navigation"}).getByRole("link",{name:"Knock",exact:true}).click();await expect(page.locator('.rm-door-actions')).toHaveCount(1);await expect.poll(()=>page.evaluate(()=>window.__watches.size)).toBe(1);
   assert.equal(await page.locator('.rm-knocking-map .leaflet-container').count(),1);
  }
  await cdp.send('HeapProfiler.collectGarbage');const end=(await cdp.send('Runtime.getHeapUsage')).usedSize;
  assert.ok(end-initial<35*1024*1024,`retained JS heap growth ${end-initial}`);
  assert.ok(personalCalls<8,'tab navigation reuses personal activity instead of rereading Firestore');assert.ok(mapCalls<8,'returning to the same viewport reuses its cache');
  // Repeated zoom does not report an empty initial territory state.
  for(let i=0;i<2;i++){await page.getByRole('button',{name:'Areas',exact:true}).click();await page.getByRole('button',{name:'Zoom to mine',exact:true}).click();await expect(page.getByText('You do not have an assigned territory yet.')).toHaveCount(0);}
  // Location failure still leaves an actionable retry button.
  await page.evaluate(()=>{window.__gpsDenied=true;Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.locator('.rm-gps-notice')).toBeVisible();await expect(page.locator('.rm-map-locate')).toBeEnabled();await page.evaluate(()=>window.__gpsDenied=false);await page.locator('.rm-map-locate').click();await expect(page.locator('.rm-gps-notice')).toHaveCount(0);
  if(role==='admin'){
   await page.getByRole('link',{name:'Open account and tools'}).click();await page.getByRole('button',{name:/Send voice feedback/}).click();await page.getByRole('button',{name:'Record feedback',exact:true}).click();await expect(page.getByRole('button',{name:/Stop ·/})).toBeVisible();await page.waitForTimeout(1200);await page.getByRole('button',{name:/Stop ·/}).click();await expect(page.locator('.rm-feedback audio')).toHaveCount(1);await page.getByLabel('What were you doing?').fill('Synthetic beta feedback');await page.getByRole('button',{name:'Send recording',exact:true}).click();await expect(page.getByRole('heading',{name:'1 unsent recording'})).toBeVisible();
   voiceFail=false;await page.getByRole('button',{name:'Retry sending',exact:true}).click();await expect(page.getByRole('heading',{name:'1 unsent recording'})).toHaveCount(0);assert.equal(uploaded.length,1);assert.equal(uploaded[0].uid,'audit-user');assert.equal(uploaded[0].note,'Synthetic beta feedback');assert.ok(uploaded[0].audio.length>100);await page.getByRole('button',{name:'Close voice feedback'}).click();
  }
  await page.screenshot({path:`${dest}/${role}.png`});results.push({role,cycles:12,personalCalls,mapCalls,retainedHeapGrowthBytes:end-initial,uniqueMapAndControls:true,gpsRetry:true,zoomToMineTwice:true,voiceRetry:role==='admin'?true:'covered in admin run'});await context.close();await browser.close();browser=null;
 }
 assert.deepEqual(errors,[]);await writeFile(`${dest}/results.json`,JSON.stringify({results,errors,liveWrites:0,nativeDevicesTested:false},null,2));console.log(JSON.stringify(results));
}catch(e){if(page){await page.screenshot({path:`${dest}/failure.png`}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-2200));}console.error(errors);throw e;}finally{await browser?.close();server.kill();}
