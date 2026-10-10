// Capture the real exported React views with fictional data, no Firebase access.
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const root=process.env.MOBILE_EXPORT_DIR || 'out';
const dest=process.env.RAYDAR_SCREENSHOTS_DIR || '/tmp/raydar-v5-screenshots';
await mkdir(dest,{recursive:true});
const server=spawn('python',['-m','http.server','4195','--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
let browser;
try {
  for(let attempt=0;attempt<30;attempt++) {
    try { if((await fetch('http://127.0.0.1:4195/mobile/preview/')).ok) break; } catch {}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE || undefined,args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:2,serviceWorkers:'block',reducedMotion:'reduce'});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1' ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:4195/mobile/preview/');
  await page.getByRole('region',{name:'Your appointment results'}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.rm-brand img').getAttribute('src'),'/brand/raydar-v5/raydar-primary-v5.svg');
  assert.equal(await page.locator('.rm-field-card').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(88, 126, 152)');
  await page.screenshot({path:`${dest}/Raydar-Today-v5.png`});
  await page.getByRole('region',{name:'Your appointment results'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`${dest}/Raydar-Results-v5.png`});
  await page.getByRole('region',{name:'Your appointment results'}).getByRole('button',{name:/215 Elm Street/}).click();
  await page.getByRole('region',{name:'Doorstep memory'}).waitFor();
  await page.screenshot({path:`${dest}/Raydar-Doorstep-Memory-v5.png`});
  await page.getByRole('button',{name:'Back to my day',exact:true}).click();
  for(const [tab,name] of [['Knock','Knock'],['Follow-ups','Follow-Ups'],['Progress','Progress']]) {
    await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:tab,exact:true}).click();
    await page.evaluate(()=>window.scrollTo(0,0));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(tab==='Knock') assert.equal((await page.locator('.rm-field-toolbar').boundingBox()).height,60);
    await page.screenshot({path:`${dest}/Raydar-${name}-v5.png`});
  }
  // Narrow phone regression: the logo, tabs and map toolbar must fit at 360px.
  await page.setViewportSize({width:360,height:800});
  for(const tab of ['Today','Knock','Follow-ups','Progress']) {
    await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:tab,exact:true}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await page.setViewportSize({width:393,height:852});
  await page.goto('http://127.0.0.1:4195/login/');
  assert.equal(await page.locator('html').getAttribute('data-raydar-native'),'true');
  assert.equal(await page.getByRole('img',{name:'Raydar',exact:true}).getAttribute('src'),'/brand/raydar-v5/raydar-primary-v5.svg');
  assert.equal(await page.getByRole('button',{name:'Sign In',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(71, 110, 136)');
  await page.screenshot({path:`${dest}/Raydar-Sign-In-v5.png`});
  assert.deepEqual(errors,[]);
  // An overview sheet made from the untouched screenshots, clearly labeled as samples.
  const sheet=await browser.newPage({viewport:{width:1760,height:1110},deviceScaleFactor:1});
  const shots=await Promise.all(['Today','Knock','Follow-Ups','Progress'].map(async name=>({name,src:(await readFile(`${dest}/Raydar-${name}-v5.png`)).toString('base64')})));
  await sheet.setContent(`<html><style>*{box-sizing:border-box}body{margin:0;background:#FFFCF5;color:#304B5E;font:16px Arial,sans-serif;padding:36px 40px}h1{margin:0 0 10px;font-size:32px}p{color:#617382;margin:0 0 28px}main{display:flex;gap:24px}section{width:402px}h2{font-size:18px;margin:0 0 14px}img{width:393px;border:1px solid #DEE6EB;border-radius:18px;display:block}footer{font-size:14px;color:#617382;margin-top:22px}</style><h1>Raydar v5 · Slate blue + yellow</h1><p>Signal R branding · Screenshots from the updated app’s sample-data preview</p><main>${shots.map(s=>`<section><h2>${s.name.replaceAll('-',' ')}</h2><img src="data:image/png;base64,${s.src}"></section>`).join('')}</main><footer>Fictional sample records. The preview map is illustrative; the installed app retains its real Map / Satellite views.</footer></html>`);
  await sheet.locator('img').last().waitFor();
  await sheet.screenshot({path:`${dest}/Raydar-App-Overview-v5.png`,fullPage:true});
  console.log('PASS: slate brand, logo, native sign-in, 60px map toolbar, all four tabs at 393px/360px, zero browser errors. Screenshots saved.');
} finally { await browser?.close(); server.kill(); }
