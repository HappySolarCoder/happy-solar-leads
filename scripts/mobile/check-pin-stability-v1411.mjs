// Exported UI with fictional leads only. No production traffic or writes.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const output='/tmp/raydar-v1411-check';await mkdir(output,{recursive:true});
const server=spawn('python3',['-m','http.server','4220','--bind','127.0.0.1','--directory','/tmp/raydar-ui-audit-out'],{stdio:'ignore'});
const results=[],errors=[];let browser,page;
try{
 for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:4220/mobile/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 for(const device of [{name:'ios',width:393,height:852},{name:'android',width:360,height:640}]){
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/tmp/raydar-browser-150/chromium',args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:device,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'});
  await context.addInitScript(()=>{
   localStorage.setItem('raydar-audit-role','admin');localStorage.setItem('raydar_install_dismissed','true');
   const stamp=i=>({seconds:Date.parse(`2026-10-0${i}T18:00:00Z`)/1000,nanoseconds:0});
   const leads={};
   for(let i=1;i<=4;i++)leads[`duplicate-${i}`]={id:`duplicate-${i}`,address:i===2?'814 Test Roof Rd, Rochester, NY':'814 Test Roof Road',city:i===3?'Irondequoit':'Rochester',state:'NY',zip:'',name:'Test household',status:i===4?'not-interested':'not-home',lat:43.15665,lng:-77.6088,createdAt:stamp(1),dispositionedAt:stamp(i),claimedBy:'audit-user',assignedTo:'audit-user',dispositionHistory:[{disposition:i===4?'Not Interested':'Not Home',timestamp:stamp(i),userId:'audit-user',userName:`Rep ${i}`},{disposition:'Interested',timestamp:{seconds:stamp(i).seconds-3600,nanoseconds:0},userId:'audit-user',userName:`Earlier rep ${i}`} ]};
   window.__raydarWriteTest={leads,writes:[],reads:[],fail:false};
   navigator.geolocation.getCurrentPosition=cb=>cb({coords:{latitude:43.1566,longitude:-77.6088,accuracy:5},timestamp:Date.now()});
  });
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  let geocodes=0;const mapCalls=[];
  await page.route('**/*',async r=>{
   const u=new URL(r.request().url());
   if(u.hostname==='firestore.googleapis.com'){const result=await page.evaluate(p=>window.__raydarFixtureRestCommit(p),r.request().postDataJSON());return r.fulfill(result);}
   if(u.pathname==='/api/solar')throw Error('Manual mobile pin must not call paid solar enrichment');
   if(u.pathname==='/api/mobile-leads'){
    mapCalls.push(u.searchParams.get('mode'));
    const leads=await page.evaluate(()=>{const wire=x=>x&&typeof x.seconds==='number'?new Date(x.seconds*1000+(x.nanoseconds||0)/1e6).toISOString():Array.isArray(x)?x.map(wire):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,wire(v)])):x;return Object.values(window.__raydarWriteTest.leads).map(l=>({...wire(l),dispositionHistory:wire(l.dispositionHistory.slice(0,1)),mobileSummary:true}));});
    return r.fulfill({json:{leads,nextCursor:null}});
   }
   if(u.pathname==='/api/geocode'){geocodes++;await new Promise(resolve=>setTimeout(resolve,1500));return r.fulfill({json:{results:[{address_components:[{types:['street_number'],long_name:'900'},{types:['route'],long_name:'Example Road'},{types:['locality'],long_name:'Rochester'}]}]}});}
   if(u.pathname.startsWith('/api/'))return r.fulfill({json:u.pathname.includes('team-area')?{territories:[],members:[]}:u.pathname.includes('historical')?{pins:[]}:u.pathname.includes('weather')?{temperature:70,condition:'Clear',hourly:[]}:{}});
   if(u.hostname==='127.0.0.1')return r.continue();
   if(/arcgisonline.com|openstreetmap.org/.test(u.hostname))return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#b9c9b4"/><path d="M0 128h256" stroke="#707779" stroke-width="20"/><g fill="#ded4be" stroke="#8a8374"><rect x="24" y="40" width="60" height="48"/><rect x="170" y="40" width="60" height="48"/></g></svg>'});
   return r.abort();
  });
  await page.goto('http://127.0.0.1:4220/mobile/knocking/');
  const pin=page.locator('.field-pin[title^="814 Test Roof"]');
  await expect(pin).toHaveCount(1,{timeout:20_000});await expect(page.locator('.raydar-homeowner-canvas')).toHaveCount(1);
  await expect(pin).toHaveAttribute('title',/Not Interested/);
  assert.equal(await pin.locator('img').evaluate(e=>e.width),14);
  await expect(page.getByRole('button',{name:/^Homes · \d+.*Open homeowner list/})).toBeVisible();
  const pinImage=await pin.locator('img').boundingBox();await page.mouse.click(pinImage.x+pinImage.width/2,pinImage.y+pinImage.height/2);await expect(page.getByRole('button',{name:'Close lead details'})).toBeVisible();
  await expect(page.getByText('Fictional Owner 14',{exact:true})).toBeVisible();
  const history=page.getByRole('region',{name:'Disposition history'});
  await expect(history.locator('li')).toHaveCount(8);await expect(history.locator('li').first()).toContainText('Not Interested');
  await expect(history).toContainText('Earlier rep 1');
  assert.ok(await history.evaluate(el=>!!(document.querySelector('button')?.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)));
  await history.scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/${device.name}-combined-history.png`});
  assert.equal(await page.evaluate(()=>window.__raydarWriteTest.writes.length),0,'selecting/merging never writes');
  await page.getByRole('button',{name:'Close lead details'}).click();
  await page.getByRole('button',{name:/^Filters/}).click();await page.getByText('Map display',{exact:true}).click();await page.getByRole('button',{name:/^Homeowner pins/}).click();
  await page.getByRole('button',{name:'Show map',exact:true}).click();
  await expect(pin).toHaveCount(1,{timeout:20_000});await expect(page.locator('.raydar-homeowner-canvas')).toHaveCount(0);
  // Native DOM touch stream: hold, jitter, drag, pinch, cancellation and normal tap.
  const touch=async(type,points)=>page.locator('.rm-knocking-map .leaflet-container').evaluate((el,{type,points})=>{
   const r=el.getBoundingClientRect();const touches=points.map(([dx,dy],identifier)=>new Touch({identifier,target:el,clientX:r.left+r.width*.24+dx,clientY:r.top+r.height*.35+dy}));
   el.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches,targetTouches:touches,changedTouches:touches}));
  },{type,points});
  await touch('touchstart',[[0,0]]);await touch('touchmove',[[3,2]]);await page.waitForTimeout(780);
  await expect(page.getByRole('heading',{name:'Add New Lead'})).toBeVisible();
  assert.equal(geocodes,1);await touch('touchend',[]);
  // Typed address stays intact when the delayed reverse lookup returns.
  await page.getByPlaceholder('123 Main St').fill('901 Typed Road');await page.waitForTimeout(1700);
  await expect(page.getByPlaceholder('123 Main St')).toHaveValue('901 Typed Road');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  for(const mode of ['tap','drag','pinch','cancel']){
   await touch('touchstart',[[0,0]]);
   if(mode==='tap')await touch('touchend',[]);
   if(mode==='drag')await touch('touchmove',[[35,0]]);
   if(mode==='pinch')await touch('touchstart',[[0,0],[40,0]]);
   if(mode==='cancel')await touch('touchcancel',[]);
   await page.waitForTimeout(780);await touch('touchend',[]);
   await expect(page.getByRole('heading',{name:'Add New Lead'})).toHaveCount(0);
  }
  assert.equal(geocodes,1,'pan/pinch/cancel never geocode');
  await touch('touchstart',[[0,0]]);await page.waitForTimeout(780);await touch('touchend',[]);
  await expect(page.getByRole('heading',{name:'Add New Lead'})).toBeVisible();
  await page.getByPlaceholder('123 Main St').fill('901 Manual Test Road');
  // Simulate a raised keyboard and a panned visual viewport. Footer remains
  // reachable while the final field can independently scroll into view.
  for(const viewport of [{height:320,top:0},{height:260,top:35}]){
   await page.evaluate(({height,top})=>{
    Object.defineProperty(window.visualViewport,'height',{configurable:true,value:height});
    Object.defineProperty(window.visualViewport,'offsetTop',{configurable:true,value:top});
    window.visualViewport.dispatchEvent(new Event('resize'));
   },viewport);
   await page.getByPlaceholder('150').fill('150');
   const save=await page.getByRole('button',{name:'Save Lead',exact:true}).boundingBox();
   const lastField=await page.getByPlaceholder('150').boundingBox();
   assert.ok(save.y>=viewport.top && save.y+save.height<=viewport.top+viewport.height,'Save fits above keyboard');
   assert.ok(lastField.y>=viewport.top && lastField.y+lastField.height<=save.y,'last field scrolls fully into view');
   await page.screenshot({path:`${output}/${device.name}-keyboard-${viewport.height}.png`});
  }
  await page.evaluate(()=>{delete window.visualViewport.height;delete window.visualViewport.offsetTop;window.visualViewport.dispatchEvent(new Event('resize'));});

  await page.locator('select').selectOption('not-home');
  await page.getByRole('button',{name:'Save Lead',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Add New Lead'})).toHaveCount(0);
  await expect(page.locator('.field-pin[title^="901 Manual Test Road"]')).toHaveCount(1);
  await expect.poll(()=>page.evaluate(()=>window.__raydarWriteTest.writes.length)).toBe(1);
  const saved=await page.evaluate(()=>window.__raydarWriteTest.writes[0].data);
  assert.equal(saved.status,'not-home');assert.equal(saved.dispositionHistory[0].userId,'audit-user');
  assert.deepEqual(saved.dispositionHistory[0].timestamp,saved.dispositionedAt);
  assert.equal(saved.knockGpsLat,43.1566);assert.equal(saved.knockGpsLng,-77.6088);
  assert.equal(saved.claimedBy,'audit-user');
  await page.goto('http://127.0.0.1:4220/mobile/field-tools/');
  const card=page.getByRole('link',{name:/Business card creator/});await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('href','https://happy-solar-bloom-portal.vercel.app/business-card');await expect(card).toHaveAttribute('target','_blank');
  await page.screenshot({path:`${output}/${device.name}-tools.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal page overflow');
  results.push({device:device.name,onePinFourRecords:true,latestOutcome:true,allEightHistoryEntries:true,homeownerInfo:true,homeownersOffDedup:true,workedSize:14,holdJitter:true,panPinchCancel:true,businessCard:true,manualCreateTimestampGps:true,keyboardFooterReachable:true,lastFieldScrollable:true,productionWrites:0});
  await browser.close();browser=null;
 }
 assert.deepEqual(errors,[]);await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors},null,2));
}catch(e){if(page)await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw e;}finally{await browser?.close();server.kill();}
