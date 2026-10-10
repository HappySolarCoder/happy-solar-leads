import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
const root=process.env.MOBILE_EXPORT_DIR || 'out';
const dest=process.env.RAYDAR_SCREENSHOTS_DIR || '/tmp/raydar-v6-screenshots';
await mkdir(dest,{recursive:true});
const server=spawn('python',['-m','http.server','4196','--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
let browser;
try {
  for(let i=0;i<30;i++) {try{if((await fetch('http://127.0.0.1:4196/mobile/preview/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE || undefined,args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:2,serviceWorkers:'block',reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('http://127.0.0.1:4196/mobile/preview/');
  await page.getByRole('navigation').getByRole('button',{name:'Knock',exact:true}).click();
  assert.equal(await page.locator('.rm-demo-pin img').first().getAttribute('width'),'30');
  assert.match(decodeURIComponent(await page.locator('.rm-demo-pin img').first().getAttribute('src')),/data-warm-lead/);
  assert.equal((await page.locator('.rm-field-toolbar').boundingBox()).height,60);
  await page.getByRole('button',{name:'Open compass, map north is up'}).click();
  // Deterministic permission simulation; this headless browser has no physical sensor.
  await page.evaluate(()=>Object.defineProperty(window.DeviceOrientationEvent,'requestPermission',{configurable:true,value:async()=>'granted'}));
  await page.getByRole('button',{name:'Turn on compass',exact:true}).click();
  await expect(page.getByRole('button',{name:'Turn off compass',exact:true})).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute',{alpha:315,beta:0,gamma:0,absolute:true})));
  await expect(page.getByLabel('Phone direction NE 45°',{exact:true})).toBeVisible();
  await page.screenshot({path:`${dest}/Raydar-Compass-v6.png`});
  await page.getByRole('button',{name:'Close compass',exact:true}).click();
  await page.screenshot({path:`${dest}/Raydar-Warm-Pins-v6.png`});
  // A relative gyro event must never replace the north-referenced heading.
  await page.evaluate(()=>window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{alpha:180,beta:0,gamma:0,absolute:false})));
  await expect(page.getByRole('button',{name:'Open compass, phone points NE 45°'})).toBeVisible();
  await page.clock.install();
  await page.clock.fastForward(9000);
  await expect(page.getByRole('button',{name:'Open compass, map north is up'})).toBeVisible();
  await page.getByRole('button',{name:'Open compass, map north is up'}).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('No compass reading');
  await page.getByRole('button',{name:'Turn off compass',exact:true}).click();
  await page.evaluate(()=>Object.defineProperty(window.DeviceOrientationEvent,'requestPermission',{configurable:true,value:async()=>'denied'}));
  await page.getByRole('button',{name:'Turn on compass',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('not allowed');
  await expect(page.getByRole('button',{name:'Turn on compass',exact:true})).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: warm badge, smaller pins, toolbar, simulated absolute heading, rejection of relative heading, stale suppression and permission denial; external requests blocked.');
} finally {await browser?.close();server.kill();}
