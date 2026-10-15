// Fictional UI/API regression. Every non-local request is intercepted.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const output='/tmp/raydar-v1411-viewport';await mkdir(output,{recursive:true});
const server=spawn('python3',['-m','http.server','4221','--bind','127.0.0.1','--directory','/tmp/raydar-ui-audit-out'],{stdio:'ignore'});
const stamp=day=>`2026-10-${String(day).padStart(2,'0')}T18:00:00Z`;
const row=(id,address,day,status='not-home')=>({id,address,city:'Rochester',state:'NY',lat:43.1566,lng:-77.6088,status,dispositionedAt:stamp(day),createdAt:stamp(1),mobileSummary:true,dispositionHistory:[{disposition:status,timestamp:stamp(day),userId:'fictional-rep',userName:'Fictional Rep'}]});
const personal=row('personal-stale','920 Stable Road',1);
const first=[{...personal,status:'not-interested',dispositionedAt:stamp(4),dispositionHistory:[{disposition:'Not Home',timestamp:stamp(5),userId:'fictional-rep',userName:'Fictional Rep'}]},row('map-only-old','921 Stable Road',2)];
const next=row('map-only-new','921 Stable Road',6,'interested');
let browser,page,phase='initial',held=[],calls=[],errors=[];
try{
 for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:4221/mobile/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/tmp/raydar-browser-151/chromium',args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'});
 await context.addInitScript(()=>{
  localStorage.setItem('raydar-audit-role','admin');localStorage.setItem('raydar_install_dismissed','true');
  window.__raydarWriteTest={leads:{},writes:[],reads:[],fail:false};
  navigator.geolocation.getCurrentPosition=cb=>cb({coords:{latitude:43.1566,longitude:-77.6088,accuracy:5},timestamp:Date.now()});
 });
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/api/mobile-leads'){
   if(u.searchParams.get('mode')==='personal')return route.fulfill({json:{leads:[personal],nextCursor:null}});
   calls.push({phase,after:u.searchParams.get('after'),south:u.searchParams.get('south')});
   if(phase==='initial')return route.fulfill({json:{leads:first,nextCursor:null}});
   if(phase==='held')return new Promise(resolve=>held.push(async payload=>{await route.fulfill(payload);resolve();}));
   if(phase==='more')return route.fulfill({json:{leads:[first[0],row('neighbor','922 Stable Road',3)],nextCursor:null}});
   return route.fulfill({status:503,json:{error:'Fictional slow network'}});
  }
  if(u.pathname.startsWith('/api/'))return route.fulfill({json:u.pathname.includes('team-area')?{territories:[],members:[]}:u.pathname.includes('historical')?{pins:[]}:u.pathname.includes('weather')?{temperature:70,condition:'Clear',hourly:[]}:{}});
  if(u.hostname==='127.0.0.1')return route.continue();
  if(/arcgisonline.com|openstreetmap.org/.test(u.hostname))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#b9c9b4"/></svg>'});
  return route.abort();
 });
 await page.goto('http://127.0.0.1:4221/mobile/knocking/');
 const pin=n=>page.locator(`.field-pin[title^="${n} Stable Road"]`);
 await expect(pin(920)).toHaveCount(1);await expect(pin(921)).toHaveCount(1);
 await expect(pin(920)).toHaveAttribute('title',/Not Home/);
 await expect(page.getByText('Loading nearby pins…',{exact:true})).toHaveCount(0);
 // Capture the marker element and observe every DOM mutation through refresh.
 await pin(921).evaluate(el=>{
  window.__originalMarker=el.closest('.leaflet-marker-icon');window.__pinGaps=[];
  window.__pinObserver=new MutationObserver(()=>{
   const n=document.querySelectorAll('.field-pin[title^="921 Stable Road"]').length;
   if(n!==1)window.__pinGaps.push(n);
  });window.__pinObserver.observe(document.querySelector('.leaflet-marker-pane'),{childList:true,subtree:true});
 });
 const pan=async dx=>{
  const box=await page.locator('.rm-knocking-map .leaflet-container').boundingBox();
  await page.mouse.move(box.x+box.width*.4,box.y+box.height*.4);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.4+dx,box.y+box.height*.4,{steps:6});await page.mouse.up();
 };
 phase='held';await pan(24);await expect.poll(()=>held.length).toBe(1);
 await expect(pin(921)).toHaveCount(1);await expect(pin(920)).toHaveAttribute('title',/Not Home/);
 await held.shift()({json:{leads:[],nextCursor:{id:'page-one',lat:43.1566}}});
 await expect.poll(()=>held.length).toBe(1);await expect(pin(921)).toHaveCount(1);
 await held.shift()({json:{leads:[next],nextCursor:{id:'page-two',lat:43.1566}}});
 await expect(page.getByRole('button',{name:'Load more pins',exact:true})).toBeVisible();
 await expect(pin(921)).toHaveAttribute('title',/Interested/);
 assert.equal(await pin(921).evaluate(el=>el.closest('.leaflet-marker-icon')===window.__originalMarker),true,'winning document keeps its marker');
 phase='more';await page.getByRole('button',{name:'Load more pins',exact:true}).click();
 await expect(pin(922)).toHaveCount(1);await expect(pin(921)).toHaveCount(1);
 assert.equal(calls.filter(c=>c.phase==='more')[0].after,'page-two','Load more resumes the cursor');
 await expect(page.getByRole('button',{name:'Load more pins',exact:true})).toHaveCount(0);
 phase='fail';await pan(-12);await expect(page.getByRole('button',{name:'Retry pins',exact:true})).toBeVisible();
 await expect(pin(921)).toHaveCount(1);await expect(pin(921)).toHaveAttribute('title',/Interested/);
 await expect(pin(920)).toHaveAttribute('title',/Not Home/);
 const evidence=await page.evaluate(()=>{window.__pinObserver.disconnect();return {pinGaps:window.__pinGaps,writes:window.__raydarWriteTest.writes};});
 assert.deepEqual(evidence.pinGaps,[]);assert.deepEqual(evidence.writes,[]);assert.deepEqual(errors,[]);
 await page.screenshot({path:`${output}/saved-pins-after-network-error.png`});
 const result={stalePersonalCannotWin:true,latestHistoryDisplayed:true,emptyPageRetainsPins:true,replacementReusesMarker:true,cursorContinuation:true,failedRefreshRetainsPins:true,noPinGaps:true,productionTraffic:false,calls,errors};
 await writeFile(`${output}/results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(e){if(page)await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw e;}finally{await browser?.close();server.kill();}
