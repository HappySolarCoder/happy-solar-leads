import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const root=process.cwd(),before=process.argv.includes('--before'),out='/tmp/raydar-render-benchmark';
await mkdir(out,{recursive:true});
await build({entryPoints:['scripts/mobile/fixtures/homeowner-render-benchmark.ts'],bundle:true,platform:'browser',outfile:`${out}/app.js`,alias:{'@/app/homeowners/CanvasLayer':before?'/tmp/raydar-perf-before/CanvasLayer.ts':path.join(root,'app/homeowners/CanvasLayer.ts'),'@':root},nodePaths:[path.join(root,'node_modules')]});
await writeFile(`${out}/index.html`,`<!doctype html><style>${await readFile('node_modules/leaflet/dist/leaflet.css','utf8')}body{margin:0}#map{width:393px;height:740px;background:#b8c4ab}</style><div id="map"></div><script src="app.js"></script>`);
const server=spawn('python',['-m','http.server','4195','--bind','127.0.0.1','--directory',out],{stdio:'ignore'});let browser;
try {
  for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:4195/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({executablePath:'/tmp/raydar-browser/chromium',args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:393,height:740},deviceScaleFactor:2}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.goto('http://127.0.0.1:4195/');
  const result=await page.evaluate(()=>window.benchmark());
  assert.deepEqual(errors,[]);assert.equal(result.canvasCount,1);assert.equal(result.resumed,true);
  if(!before){assert.equal(result.pausedDraws,0);assert.equal(result.exactHit,true);assert.equal(result.panHit,true);}
  await writeFile(`/tmp/raydar-v123-study/render-${before?'before':'after'}.json`,JSON.stringify({...result,cpuThrottle:4,errors},null,2));
  console.log(JSON.stringify({before,...result}));
} finally {await browser?.close();server.kill();}
