// Safe-area and offline-tool checks against the isolated static export.
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const server=spawn('python',['-m','http.server','4212','--bind','127.0.0.1','--directory','/tmp/raydar-ui-audit-out'],{stdio:'ignore'});let browser;
try{
 for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:4212/mobile/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:'/tmp/raydar-browser/chromium',args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:393,height:852},hasTouch:true});const errors=[],unexpected=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('raydar-audit-role','admin');document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.native='ios';document.documentElement.style.setProperty('--safe-area-inset-top','59px');document.documentElement.style.setProperty('--safe-area-inset-bottom','34px');});});
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.pathname.startsWith('/api/')){if(/field-|mobile-user/.test(u.pathname))unexpected.push(u.pathname);return r.fulfill({json:{goal:null,goals:[]}});}if(u.hostname==='127.0.0.1')return r.continue();return r.abort();});
 const routes=['/mobile/','/mobile/follow-ups/','/mobile/stats/','/mobile/more/','/mobile/field-tools/','/mobile/field-tools/settings/'];
 for(const route of routes){await page.goto('http://127.0.0.1:4212'+route);await expect(page.locator('.rm-nav')).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);const nav=await page.locator('.rm-nav').boundingBox();assert.ok(nav.y+nav.height<=852-34+1,`home indicator safe area: ${route}`);}
 await expect(page.getByText('Advanced pilot settings are currently unavailable in the mobile app.')).toBeVisible();await expect(page.getByRole('button',{name:'Save pilot settings'})).toHaveCount(0);
 await page.goto('http://127.0.0.1:4212/mobile/field-tools/');const prepare=page.getByRole('button',{name:/Prepare up to .*matching doors offline/});await expect(prepare).toBeEnabled();await prepare.click();await expect(page.getByText(/doors prepared for 24 hours/)).toBeVisible();
 const prepared=await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('raydar-field-v11',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const q=r.result.transaction('areas').objectStore('areas').get('audit-user');q.onsuccess=()=>{const area=q.result;resolve({uid:area.userId,count:area.leads.length,capture:area.config.enabled.capture});r.result.close()};q.onerror=()=>reject(q.error)}}));assert.equal(prepared.uid,'audit-user');assert.ok(prepared.count>0);assert.equal(prepared.capture,false);
 assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);await writeFile('/tmp/raydar-v141-layout-results.json',JSON.stringify({simulatedInsets:{top:59,bottom:34},routes,offlinePreparationEnabled:true,prepared,captureOff:true,noFieldApiCalls:true,errors,limitation:'Chromium with synthetic iPhone insets; not an actual iPhone keyboard or WKWebView test.'},null,2));console.log('iPhone-inset layout and offline preparation checks passed with isolated fixtures.');
}finally{await browser?.close();server.kill();}
