// Read-only browser smoke check against an exported fictional preview. Never uses company data.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const root = process.env.MOBILE_EXPORT_DIR || 'out';
const server = spawn('python', ['-m','http.server','4193','--bind','127.0.0.1','--directory',root], {stdio:'ignore'});
let browser;
try {
  for (let attempt=0;attempt<30;attempt++) {
    try { if ((await fetch('http://127.0.0.1:4193/mobile/preview/')).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve,200));
  }
  browser = await chromium.launch({ executablePath:process.env.CHROMIUM_EXECUTABLE || undefined, args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage'] });
  const page = await browser.newPage({viewport:{width:393,height:852},serviceWorkers:'block', reducedMotion:'reduce'});
  const errors=[];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:4193/mobile/preview/');
  const feed = page.getByRole('region',{name:'Your appointment results'});
  await feed.waitFor();
  await feed.getByRole('button',{name:/215 Elm Street/}).click();
  await page.getByRole('region',{name:'Doorstep memory'}).waitFor();
  await page.getByRole('button',{name:'Asked for spouse to be home',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'Sample note draft'}).inputValue(),'Asked for spouse to be home');
  await page.screenshot({path:'/tmp/raydar-memory.png'});
  await page.getByRole('button',{name:'Back to my day',exact:true}).click();
  await feed.getByRole('button',{name:'Mark all seen',exact:true}).click();
  await page.reload();
  await page.getByText('You’re caught up on this device.',{exact:false}).waitFor();
  await feed.scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/raydar-results.png'});
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Knock',exact:true}).click();
  const reminder = page.getByRole('complementary',{name:'Nearby return visit'});
  await reminder.waitFor();
  await page.screenshot({path:'/tmp/raydar-return.png'});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  await reminder.getByRole('button',{name:'In 10 min',exact:true}).click();
  assert.equal(await reminder.count(),0);
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Today',exact:true}).click();
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Knock',exact:true}).click();
  assert.equal(await reminder.count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: outcome open/seen persistence, memory draft, reminder/snooze persistence, 393px layout, no browser errors; external requests blocked.');
} finally { await browser?.close(); server.kill(); }
