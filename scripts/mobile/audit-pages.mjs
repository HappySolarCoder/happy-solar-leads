import {spawn} from 'node:child_process';
import {mkdir,readdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {users,leads,clock} from './fixtures/data.mjs';
const root='/tmp/raydar-ui-audit-out',dest='/tmp/raydar-ui-audit-screenshots';await mkdir(dest,{recursive:true});
async function pages(dir='app'){const routes=[];for(const entry of await readdir(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())routes.push(...await pages(full));else if(entry.name==='page.tsx')routes.push('/'+path.dirname(full).replace(/^app\/?/,''));}return routes;}
const routes=(await pages()).sort();const server=spawn('python',['-m','http.server','4200','--bind','127.0.0.1','--directory',root],{stdio:'ignore'});let browser;const smokeOnly=process.argv.includes('--smoke-only');const results=smokeOnly?JSON.parse(await readFile('/tmp/raydar-page-audit.json','utf8')):[];
try{
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:4200/mobile/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/tmp/raydar-browser/chromium',args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,deviceScaleFactor:1,timezoneId:'America/Phoenix',geolocation:{latitude:43.152,longitude:-77.602},permissions:['geolocation'],serviceWorkers:'block',reducedMotion:'reduce'});
 await context.addInitScript(()=>{if(!localStorage.getItem('raydar-audit-role'))localStorage.setItem('raydar-audit-role','admin');localStorage.setItem('raydar_install_dismissed','true');});
 const page=await context.newPage();let errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.pathname.startsWith('/api/')){requests.push({path:u.pathname,method:r.request().method()});const all=users(),actor=all[0],serialized=leads().map(l=>({...l,createdAt:clock.toISOString(),dispositionedAt:clock.toISOString(),goBackScheduledDate:clock.toISOString(),dispositionHistory:l.dispositionHistory.map(h=>({...h,timestamp:clock.toISOString()}))}));let json={};const p=u.pathname;if(p==='/api/territory-management')json={actor,members:all,territories:[]};else if(p==='/api/mobile-user-management')json={actorId:actor.id,users:all.map(x=>({...x,version:'fixture',deleted:false,deletionPending:false}))};else if(p==='/api/field-config')json={config:{version:'fixture',experiment:'audit',pilotPercent:100,enabled:Object.fromEntries(['capture','scoring','timing','preview','proof','pitch','recovery','show','coaching'].map(k=>[k,true])),allowedUsers:[],openers:[],proof:[],savings:null,startHour:0,endHour:24}};else if(p.includes('/stats/'))json={leads:serialized,users:all};else if(p.includes('sync-appointments'))json={status:{lastSuccessAt:new Date().toISOString()},ok:true};else if(p.includes('team-area'))json={territories:[],members:[]};else if(p.includes('historical'))json={pins:[]};else if(p.includes('weather'))json={temperature:70,condition:'Clear',icon:'sun',hourly:[]};else if(p.includes('goals'))json={goal:null,goals:[]};else if(p.includes('solar-madness'))json={enabled:false,matchups:[],bracket:null};else if(p.includes('connections'))json={connections:[]};return r.fulfill({json});}if(u.hostname==='127.0.0.1')return r.continue();if(/arcgisonline.com|openstreetmap.org/.test(u.hostname))return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e6e9e2"/><path d="M0 80h256M90 0v256" stroke="#fffdf6" stroke-width="16"/><text x="8" y="245" font-size="10" fill="#63736b">FICTIONAL AUDIT TILE</text></svg>'});return r.abort();});
 for(const route of smokeOnly?[]:routes){errors=[];requests=[];try{const response=await page.goto(`http://127.0.0.1:4200${route==='/'?'/':route+'/'}`,{waitUntil:'load',timeout:20000});await page.waitForTimeout(route.includes('preview')?900:1500);const scan=()=>page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+2,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,text:document.body.innerText.slice(0,750),unlabeled:[...document.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().height>0&&!b.innerText.trim()&&!b.getAttribute('aria-label')&&!b.getAttribute('title')).length,links:[...document.querySelectorAll('a[href^="/"]')].map(a=>a.getAttribute('href'))}));const phone=await scan();const filename=(route==='/'?'root':route.slice(1).replaceAll('/','-'))+'.png';await page.screenshot({path:`${dest}/${filename}`});await page.setViewportSize({width:360,height:800});const narrow=await scan();await page.setViewportSize({width:393,height:852});results.push({route,status:response.status(),landed:new URL(page.url()).pathname,phone,narrow,errors:[...new Set(errors)],requests,screenshot:filename});}catch(e){results.push({route,error:e.message,errors});}if(results.length%6===0)console.log(`Audited ${results.length}/${routes.length} routes`);}

 const existing=new Set(routes);for(const r of results)r.brokenLinks=[...new Set((r.phone?.links||[]).filter(l=>!existing.has(l.split(/[?#]/)[0].replace(/\/$/,'')||'/')))];
 await writeFile('/tmp/raydar-page-audit.json',JSON.stringify(results,null,2));
 // Interactive regression checks on the same isolated bundle.
 errors=[];
 await page.goto('http://127.0.0.1:4200/mobile/');
 await page.getByRole('link',{name:'View all',exact:true}).click();
 await expect(page).toHaveURL(/\/mobile\/follow-ups\/?$/);console.log('Follow-up navigation passed');
 await page.getByRole('link',{name:'Knock',exact:true}).click();
 await page.getByRole('button',{name:/^Center map on my location/}).click();
 await page.waitForTimeout(450);
 await expect(page.locator('.leaflet-marker-icon[title]').first()).toBeVisible();
 const pinCount=await page.locator('.leaflet-marker-icon[title]').count();
 const reachablePin=()=>page.locator('.leaflet-marker-icon.field-pin').evaluateAll(markers=>{for(const marker of markers){const box=marker.getBoundingClientRect();for(const dx of [.5,.3,.7])for(const dy of [.5,.3,.7]){const x=box.x+box.width*dx,y=box.y+box.height*dy;if(x>0&&x<innerWidth&&y>0&&y<innerHeight&&document.elementFromPoint(x,y)?.closest('.field-pin')===marker)return {x,y};}}return null;});
 await expect.poll(reachablePin).toBeTruthy();const pinPoint=await reachablePin();
 assert.ok(pinPoint,'a worked pin is reachable in the viewport');await page.mouse.click(pinPoint.x,pinPoint.y);
 await expect(page.getByRole('button',{name:'Close lead details'})).toBeVisible();
 await expect(page.locator('.leaflet-marker-icon[title]')).toHaveCount(pinCount);
 await page.getByRole('button',{name:'Close lead details'}).click();
 await expect(page.locator('.leaflet-marker-icon[title]')).toHaveCount(pinCount);
 console.log('Pin selection passed');await page.goto('http://127.0.0.1:4200/mobile/team-map/');
 await expect(page.locator('.raydar-team-marker')).toHaveCount(3);
 await page.getByRole('button',{name:'Hide team list'}).click();
 await expect(page.getByRole('button',{name:'Show team list'})).toBeVisible();
 await page.locator('.raydar-team-marker[title="Example FMA 2"] > div > div').click();
 await expect(page.getByRole('button',{name:'Back to team list'})).toBeVisible();
 await page.getByRole('button',{name:'Back to team list'}).click();
 await page.getByRole('combobox',{name:'Team activity period'}).selectOption('yesterday');
 await page.getByRole('link',{name:'Back to workspace'}).click();
 await page.getByRole('link',{name:/Manage workspace/}).click();
 await expect(page.getByRole('heading',{name:'Manage workspace'})).toBeVisible();
 await page.getByRole('link',{name:/Manage Users/}).click();
 await expect(page.getByRole('heading',{name:'Manage Users'})).toBeVisible();
 await page.evaluate(()=>localStorage.setItem('raydar-audit-role','setter'));
 await page.goto('http://127.0.0.1:4200/mobile/more/');
 await expect(page.getByRole('link',{name:/Manage workspace/})).toHaveCount(0);
 await expect(page.getByRole('link',{name:/Manage territories/})).toHaveCount(0);
 await page.goto('http://127.0.0.1:4200/mobile/team-map/');
 await expect(page.getByText('Team locations are available to managers and admins.')).toBeVisible();
 assert.deepEqual(errors,[]);
 await writeFile('/tmp/raydar-ui-smoke-results.json',JSON.stringify({followUpLink:true,pinSelectionPreserved:true,teamMap:true,workspaceUsers:true,setterRestrictions:true,errors},null,2));
 console.log('Interactive checks passed: follow-ups, pin selection, team map, workspace, setter access.');

 await writeFile('/tmp/raydar-page-audit.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.filter(r=>r.error||r.errors.length||r.phone?.overflow||r.narrow?.overflow||r.phone?.unlabeled||r.narrow?.unlabeled||r.brokenLinks.length).map(r=>({route:r.route,error:r.error,errors:r.errors,overflow:r.phone?.overflow||r.narrow?.overflow,brokenLinks:r.brokenLinks,unlabeled:r.phone?.unlabeled,text:r.phone?.text.slice(0,120)})),null,2));console.log(`Audit complete: ${results.length} routes. All remote requests were mocked or blocked.`);
}finally{await browser?.close();server.kill();}
