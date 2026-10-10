import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
const baseline=process.argv.includes('--before');
const root=baseline?'/tmp/raydar-v123-baseline-out':'/tmp/raydar-ui-audit-out';
const dest='/tmp/raydar-v123-study';
await mkdir(dest,{recursive:true});
const server=spawn('python',['-m','http.server','4196','--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
let browser;
try {
  for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:4196/mobile/homeowners/preview/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
  browser=await chromium.launch({executablePath:'/tmp/raydar-browser/chromium',args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,deviceScaleFactor:2,serviceWorkers:'block',reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[],remote=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{
    const u=new URL(r.request().url());
    if(u.hostname==='127.0.0.1')return r.continue();
    if(/arcgisonline.com|openstreetmap.org/.test(u.hostname))return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#bbc5ac"/><path d="M0 128h256M128 0v256" stroke="#73787a" stroke-width="23"/><path d="M0 128h256M128 0v256" stroke="#b0b1a3" stroke-width="1" stroke-dasharray="10 15"/><g fill="#ded9c6" stroke="#766d5e" stroke-width="2"><path d="M17 21h61v45H17zM161 18h63v46h-63zM23 173h53v46H23zM175 178h54v47h-54z"/></g><g fill="#7e796d"><path d="m17 21 30 22 31-22M161 18l31 23 32-23M23 173l26 23 27-23M175 178l27 23 27-23"/></g><g fill="#527351" opacity=".85"><circle cx="90" cy="87" r="18"/><circle cx="198" cy="89" r="17"/><circle cx="88" cy="237" r="18"/><circle cx="154" cy="243" r="13"/></g></svg>'});
    remote.push(u.href);return r.abort();
  });
  await page.goto('http://127.0.0.1:4196/mobile/homeowners/preview/');
  await expect(page.locator('.raydar-homeowner-canvas')).toHaveCount(1);
  // Match the map's exact screen area in both builds, independent of test controls.
  await page.locator('strong').filter({hasText:'Fictional map test'}).evaluate(e=>{e.parentElement.style.height='112px';e.parentElement.style.flex='0 0 112px';});
  await page.waitForTimeout(1250);
  const results=[];
  for(const [zoom,button] of [[17,null],[18,'Roof view'],[15,'Neighborhood view']]) {
    if(button){
      if(baseline&&zoom===15){await page.locator('.leaflet-container').focus();await page.keyboard.press('-');await page.waitForTimeout(750);await page.keyboard.press('-');await page.waitForTimeout(750);await page.keyboard.press('-');}
      else await page.getByRole('button',{name:button,exact:true}).click();
      await page.waitForTimeout(1250);
    }
    await expect(page.locator('.leaflet-marker-icon[title^="720 Example"] img')).toHaveAttribute('width',String((baseline?{15:34,17:36,18:30}:{15:18,17:24,18:20})[zoom]));
    const coverage=await page.locator('.raydar-homeowner-canvas').evaluate(c=>{const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let covered=0,solid=0;for(let i=3;i<a.length;i+=4){if(a[i])covered++;if(a[i]>128)solid++;}return{coverage:covered/(a.length/4),solid:solid/(a.length/4),width:c.width,height:c.height};});
    results.push({zoom,...coverage});
    await page.locator('.leaflet-container').screenshot({path:`${dest}/${baseline?'before':'after'}-zoom-${zoom}.png`});
  }
  if(!baseline){
    await page.getByRole('button',{name:'Roof view',exact:true}).click();await page.waitForTimeout(1250);
    // A worked pin stays a 44px target while the image is smaller.
    const worked=page.locator('.leaflet-marker-icon[title^="720 Example"]');
    await expect(worked).toHaveCount(1);assert.equal((await worked.boundingBox()).width,44);
    await expect(worked.locator('img')).toHaveAttribute('width','20');
    await worked.locator('img').click();await expect(page.getByRole('dialog',{name:'Existing visit fixture'})).toContainText('Fictional Owner 620');
    await page.getByRole('button',{name:'Close visit'}).click();await expect(worked).toHaveCount(1);
    // Find an actually painted small mark and tap just outside its visible edge.
    const point=await page.locator('.raydar-homeowner-canvas').evaluate(c=>{const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data,b=c.getBoundingClientRect(),s=c.width/b.width;for(let y=200*s;y<c.height-100*s;y++)for(let x=40*s;x<c.width/3;x++)if(a[(y*c.width+x)*4+3]>200)return{x:b.x+x/s,y:b.y+y/s};return null;});
    assert.ok(point);await page.mouse.click(point.x+8,point.y);await expect(page.getByRole('dialog',{name:'Homeowner details'})).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Homeowner details'})).toHaveCount(0);
    // Close neighbors at neighborhood zoom: tapping a small home inside a
    // worked marker's transparent padding must open the home's own details.
    await page.getByRole('button',{name:'Neighborhood view',exact:true}).click();await page.waitForTimeout(1250);
    const nearby=await worked.evaluate(el=>{const c=document.querySelector('.raydar-homeowner-canvas'),a=c.getContext('2d').getImageData(0,0,c.width,c.height).data,b=c.getBoundingClientRect(),box=el.getBoundingClientRect(),im=el.querySelector('img').getBoundingClientRect(),s=c.width/b.width;for(let y=Math.max(box.top,im.top-15);y<box.bottom;y+=.5)for(let x=box.left;x<box.right;x+=.5){const cx=Math.round((x-b.x)*s),cy=Math.round((y-b.y)*s);if(cx<0||cy<0||cx>=c.width||cy>=c.height)continue;if(a[(cy*c.width+cx)*4+3]>200&&document.elementFromPoint(x,y)?.closest('.field-pin')===el&&!(x>=im.left&&x<=im.right&&y>=im.top&&y<=im.bottom))return{x,y};}return null;});
    assert.ok(nearby,'dense fixture includes a property under worked-pin padding');await page.mouse.click(nearby.x,nearby.y);await expect(page.getByRole('dialog',{name:'Homeowner details'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Homeowner details'})).toHaveCount(0);
    await worked.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog',{name:'Existing visit fixture'})).toBeVisible();await page.getByRole('button',{name:'Close visit'}).click();
    await page.getByRole('button',{name:'Zoom out',exact:true}).click();await page.waitForTimeout(1250);
    assert.equal(await page.locator('.raydar-homeowner-canvas').evaluate(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v)),false);
    await page.getByRole('button',{name:'Roof view',exact:true}).click();await page.waitForTimeout(1250);
    for(const viewport of [{width:360,height:800},{width:852,height:393}]){await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);}
  }
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  await writeFile(`${dest}/${baseline?'before':'after'}-coverage.json`,JSON.stringify({results,errors,remote},null,2));
  console.log(JSON.stringify({baseline,results,errors,remote}));
} finally {await browser?.close();server.kill();}
