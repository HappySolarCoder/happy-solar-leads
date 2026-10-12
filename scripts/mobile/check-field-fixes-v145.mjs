// Actual shared pages with synthetic Firebase/API fixtures; no production reads/writes.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { leads, users } from './fixtures/data.mjs';

const dest='/tmp/raydar-v145-check'; await mkdir(dest,{recursive:true});
const server=spawn('python',['-m','http.server','4215','--bind','127.0.0.1','--directory','/tmp/raydar-ui-audit-out'],{stdio:'ignore'});
let browser, page;
const results=[], errors=[], forbidden=[];
try {
  for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:4215/mobile/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
  for(const device of [{platform:'ios',width:393,height:852,top:59,bottom:34},{platform:'android',width:360,height:800,top:24,bottom:24}]) {
    browser=await chromium.launch({executablePath:'/tmp/raydar-browser/chromium',args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage']});
    const seed=Object.fromEntries(leads().map(l=>[l.id,{...l,goBackScheduledBy:'another-rep'}]));
    for(let i=0;i<55;i++)seed[`cleanup-${i}`]={...leads()[2],id:`cleanup-${i}`,address:`${1000+i} Cleanup Lane`,goBackScheduledBy:'audit-user'};
    const context=await browser.newContext({viewport:{width:device.width,height:device.height},hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'});
    await context.addInitScript(({device,seed})=>{
      if(location.protocol==='about:')return;
      localStorage.setItem('raydar_install_dismissed','true');
      if(!localStorage.getItem('raydar-audit-role'))localStorage.setItem('raydar-audit-role','admin');
      window.__raydarWriteTest=JSON.parse(localStorage.getItem('raydar-fixture-backend')||JSON.stringify({leads:seed,writes:[],reads:[],fail:false}));
      Object.defineProperty(navigator,'onLine',{get:()=>localStorage.getItem('raydar-fixture-offline')!=='1'});
      document.addEventListener('DOMContentLoaded',()=>{
        document.documentElement.dataset.native=device.platform;
        document.documentElement.style.setProperty('--safe-area-inset-top',device.top+'px');
        document.documentElement.style.setProperty('--safe-area-inset-bottom',device.bottom+'px');
      });
    },{device,seed});
    page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
    let territories=Array.from({length:5},(_,i)=>({id:`area-${i}`,userId:'audit-rep-1',userName:'Example FMA 1',name:`Area ${i+1}`,userColor:'#587E98',version:'v1',leadIds:['history-pin'],leadCount:1,polygon:[{lat:43.15,lng:-77.61},{lat:43.15,lng:-77.60},{lat:43.16,lng:-77.60},{lat:43.16,lng:-77.61}]}));
    territories.push({...territories[0],id:'other-area',userId:'audit-rep-2',userName:'Example FMA 2',name:'Other rep area'});
    const territoryCalls=[]; let failTerritory=true;
    await page.route('**/*',async r=>{
      const u=new URL(r.request().url());
      if(u.pathname.startsWith('/api/')) {
        if(/field-work|field-config|field-recovery|mobile-user-management/.test(u.pathname))forbidden.push(u.pathname);
        if(u.pathname==='/api/territory-management') {
          if(r.request().method()==='GET') return r.fulfill({json:{actor:users()[0],members:users(),territories}});
          const body=r.request().postDataJSON(); territoryCalls.push(body);
          if(body.action!=='archive')return r.fulfill({status:400,json:{error:'Unknown territory action.'}});
          if(body.id==='area-1'&&failTerritory){failTerritory=false;return r.fulfill({status:503,json:{error:'Fictional temporary failure'}});}
          territories=territories.filter(t=>t.id!==body.id);return r.fulfill({json:{id:body.id,changed:0}});
        }
        return r.fulfill({json:u.pathname.includes('historical')?{pins:[]}:u.pathname.includes('goals')?{doorKnocksGoal:null}:{}});
      }
      if(u.hostname==='127.0.0.1')return r.continue();
      if(/arcgisonline.com|openstreetmap.org/.test(u.hostname))return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e5ebdf"/><text x="10" y="20">FICTIONAL TEST MAP</text></svg>'});
      return r.abort();
    });
    const go=route=>page.goto('http://127.0.0.1:4215'+route);
    const writes=()=>page.evaluate(()=>window.__raydarWriteTest.writes);
    await go('/mobile/follow-ups/');
    await expect(page.getByRole('button',{name:'All 55',exact:true})).toBeVisible();
    await expect(page.locator('.rm-lead-row')).toHaveCount(50);
    await expect(page.locator('.rm-lead-row').filter({hasText:'Example Lane'})).toHaveCount(0);
    await page.locator('.rm-lead-row').filter({hasText:'1000 Cleanup Lane'}).click();
    const quick=page.getByRole('group',{name:'Quick knock actions'});
    await expect(quick.getByRole('button')).toHaveCount(3);
    assert.deepEqual(await quick.getByRole('button').allTextContents(),['NH','NI','CSM']);
    const boxes=await quick.getByRole('button').evaluateAll(items=>items.map(b=>{const r=b.getBoundingClientRect();return {y:r.y,width:r.width,height:r.height};}));
    assert.ok(boxes.every(b=>b.height>=44&&b.width>=60&&Math.abs(b.y-boxes[0].y)<1));
    await expect(page.getByRole('button',{name:'NH — Not Home',exact:true})).toHaveCount(1);
    await quick.scrollIntoViewIfNeeded(); await page.screenshot({path:`${dest}/${device.platform}-quick-actions.png`});
    await page.getByRole('button',{name:'Close lead details'}).click();
    await page.getByRole('button',{name:'Select to clean up'}).click();
    await page.getByRole('button',{name:'Select all (55)',exact:true}).click();
    await page.getByRole('button',{name:'Remove (55)',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Remove selected follow-ups'});
    await expect(dialog).toContainText('history are kept');
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await writes()).length,0);
    await page.getByRole('button',{name:'Remove (55)',exact:true}).click();
    await page.evaluate(()=>{localStorage.setItem('raydar-fixture-offline','1');window.dispatchEvent(new Event('offline'));});
    await dialog.getByRole('button',{name:'Remove follow-ups',exact:true}).click();
    await expect(dialog.getByRole('alert')).toContainText('Connect');assert.equal((await writes()).length,0);
    await page.evaluate(()=>{localStorage.setItem('raydar-fixture-offline','0');window.dispatchEvent(new Event('online'));window.__raydarWriteTest.fail=true;});
    await dialog.getByRole('button',{name:'Remove follow-ups',exact:true}).click();
    await expect(dialog.getByRole('alert')).toContainText('Fictional save failed');assert.equal((await writes()).length,0);
    await page.evaluate(()=>{window.__raydarWriteTest.fail=false;window.__raydarWriteTest.leads['cleanup-0'].goBackScheduledTime='18:00';});
    await dialog.getByRole('button',{name:'Remove follow-ups',exact:true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status').filter({hasText:'54 follow-ups removed'})).toBeVisible();
    await expect(page.getByRole('button',{name:'All 1',exact:true})).toBeVisible();
    const saved=await writes();assert.equal(saved.length,54);assert.ok(saved.every(w=>w.path.startsWith('leads/')));
    for(const w of saved)assert.deepEqual(w.data,{goBackScheduledDate:null,goBackScheduledTime:''});
    await page.reload();await expect(page.getByRole('button',{name:'All 1',exact:true})).toBeVisible();
    for(const role of ['manager','setter']) {
      await page.evaluate(role=>localStorage.setItem('raydar-audit-role',role),role);await page.reload();
      await expect(page.getByRole('button',{name:'All 1',exact:true})).toBeVisible();
    }
    await page.screenshot({path:`${dest}/${device.platform}-follow-ups.png`});
    await go('/mobile/stats/');await expect(page.locator('.rm-nav')).toBeVisible();
    const nav=await page.locator('.rm-nav').boundingBox(), content=await page.locator('main.rm-content').boundingBox();
    assert.ok(Math.abs(nav.y+nav.height-(device.height-device.bottom))<2,'navigation is at bottom safe area');
    assert.ok(content.y+content.height<=nav.y+1,'scrolling content ends above navigation');
    assert.ok(content.height>device.height-device.top-device.bottom-175,'no large footer steals the scroll area');
    await page.getByRole('button',{name:/Contact, engagement/}).scrollIntoViewIfNeeded();
    const link=await page.getByRole('button',{name:/Contact, engagement/}).boundingBox();
    assert.ok(link.y+link.height<=nav.y+1,'last action scrolls entirely above navigation');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.screenshot({path:`${dest}/${device.platform}-progress-bottom.png`});
    await page.locator('main.rm-content').evaluate(el=>el.scrollTop=0);
    await page.screenshot({path:`${dest}/${device.platform}-progress-top.png`});
    await page.evaluate(()=>localStorage.setItem('raydar-audit-role','admin'));
    await go('/mobile/territories/');await expect(page.locator('.rt-shell')).toBeVisible();
    await page.getByRole('button',{name:/^Choose territory user:/}).click();
    await page.getByLabel('Search users').fill('Example FMA 1');
    await page.getByRole('button',{name:'Select Example FMA 1',exact:true}).click();
    await expect(page.locator('.rt-area')).toHaveCount(5);
    await page.getByRole('button',{name:'Delete all territories',exact:true}).click();
    const deleteDialog=page.getByRole('dialog',{name:'Delete all territories'});
    await deleteDialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(territoryCalls.length,0);
    await page.getByRole('button',{name:'Delete all territories',exact:true}).click();
    await deleteDialog.getByRole('button',{name:'Delete all territories',exact:true}).click();
    await expect(deleteDialog.getByRole('alert')).toContainText('Fictional temporary failure');
    await expect(page.locator('.rt-area')).toHaveCount(4);
    const failedId=territoryCalls[1].requestId;
    await deleteDialog.getByRole('button',{name:'Delete all territories',exact:true}).click();
    await expect(deleteDialog).toHaveCount(0);await expect(page.locator('.rt-area')).toHaveCount(0);
    assert.equal(territoryCalls[2].requestId,failedId);assert.ok(territoryCalls.every(c=>c.action==='archive'));
    assert.deepEqual(territories.map(t=>t.id),['other-area']);assert.equal((await writes()).length,54,'territory deletion never writes leads');
    await page.screenshot({path:`${dest}/${device.platform}-territories.png`});
    results.push({platform:device.platform,quickActionsSingleRow:true,personalFollowUpsAllRoles:true,bulkCancellationAndRetry:true,concurrentReschedulePreserved:true,paginationAndSelectAll:true,progressSafeArea:true,territoryLegacyBackendAndPartialRetry:true,fixtureFollowUpWrites:54,productionWrites:0});
    await browser.close();browser=null;
  }
  assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[]);
  await writeFile(`${dest}/results.json`,JSON.stringify({engine:'Chromium with simulated iPhone/Android safe areas; not native device acceptance',results,errors,forbidden},null,2));
  console.log('v14.5 field fixes passed on iPhone/Android viewport fixtures. No production requests.');
} catch(e) {
  if(page&&!page.isClosed()){await page.screenshot({path:`${dest}/failure.png`});console.error((await page.locator('body').innerText()).slice(-3500));}
  console.error(errors);throw e;
} finally {await browser?.close();server.kill();}
