// Actual Today/provider/live hook/storage with isolated Firebase fixtures.
// This checks app behavior, not iOS transport or production permissions.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const root = process.cwd(), dest = '/tmp/raydar-data-loading';
await mkdir(dest, { recursive: true });
const mocks = {
  'next/navigation': `export const usePathname=()=>'/mobile';export const useRouter=()=>({replace:()=>{},push:()=>{}});`,
  'next/dynamic': `export default ()=>()=>null;`,
  '@/app/components/LeadDetail': `export default ()=>null;`,
  '@/app/mobile/_components/MobileShell': `import React from 'react';export const MobileHeader=()=>null;export const MobileNav=()=>null;export const MobileLoading=()=> <div>Loading account</div>;export const MobileNotice=({children})=><div role="status">{children}</div>;`,
  './_components/MobileShell': `export * from '@/app/mobile/_components/MobileShell';`,
  './MobileShell': `export * from '@/app/mobile/_components/MobileShell';`,
  './_components/MobileViews': `import React from 'react';export const TodayView=p=><div><h1>Today</h1><span data-testid="target">{p.dailyTarget}</span></div>;`,
  './UnsyncedNotice': `export default ()=>null;`,
  '@/app/utils/firebase': `export const db={};export const auth={get currentUser(){return window.fx.account},authStateReady:async()=>{}};`,
  'firebase/auth': `export const onAuthStateChanged=(a,cb)=>{const fn=()=>cb(a.currentUser);window.fx.authListeners.add(fn);queueMicrotask(fn);return()=>window.fx.authListeners.delete(fn)};`,
  'firebase/firestore': `
    export const doc=(d,c,id)=>({c,id});
    export const getDoc=async ref=>{window.fx.profileReads++;return {exists:()=>true,data:()=>({name:'Test Rep',role:window.fx.role})}};
    export const collection=(d,c)=>({c});export const where=(...args)=>args;
    export const query=(s,...filters)=>({...s,filters});
    export function onSnapshot(q,options,next,error){const s={q,next,error,active:true};window.fx.subscriptions.push(s);queueMicrotask(()=>{if(s.active)next(window.fx.snapshot([],true))});return()=>{s.active=false}};
  `,
  '@/app/utils/dispositions': `export const isScheduledGoBackLead=()=>false;export const getDispositionsAsync=async()=>[{id:'not-home',countsAsDoorKnock:true}];`,
  '@/app/field/useFieldData': `export const useFieldData=(u,leads)=>({leads,drafts:[],retrySync:()=>{},offline:false});`,
  '@/app/field/deviceStore': `export const readArea=async()=>null;`,
  '@/app/utils/goals': `export const getMyGoalViaApiAsync=async()=>{window.fx.goalReads++;return {doorKnocksGoal:10}};export const countWorkdaysElapsedAndRemaining=()=>({remaining:1});export const getMyMonthlyKnocksAsync=()=>{throw Error('Duplicate lead read')};`,
  '@/app/utils/firestore': `export const mapLeadDoc=d=>d.data();`,
  './firestore': `
    export const getAllUsers=async()=>{window.fx.directoryReads++;if(window.fx.directoryHang)await new Promise(r=>window.fx.finishDirectory=r);return [{id:window.fx.account.uid,name:'Fixture'}]};
    export const getAllLeads=()=>{throw Error('Duplicate lead read')};export const getLead=()=>{};export const getLeadsForUser=()=>{};export const getLeadsInBounds=()=>{};export const getLeadsInBoundsForUser=()=>{};export const saveLead=()=>{};export const batchSaveLeads=()=>{};export const updateLead=()=>{};export const deleteLead=()=>{};export const saveUser=()=>{};export const updateUser=()=>{};export const getUser=()=>{};
  `,
  './auth': `export const getCurrentAuthUser=()=>{throw Error('Duplicate profile lookup')};`,
};
// Relative firebase imports in storage resolve to the same mock.
mocks['./firebase'] = mocks['@/app/utils/firebase'];
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';
import Page from './app/mobile/page';
import {MobileDataBoundary,useMobileData} from './app/mobile/_components/MobileDataProvider';
import {getUsersAsync} from './app/utils/storage';
window.fx={account:{uid:'test-rep'},role:'admin',profileReads:0,goalReads:0,directoryReads:0,subscriptions:[],authListeners:new Set(),
 snapshot:(leads,fromCache=false)=>({metadata:{fromCache},docChanges:()=>leads.map(l=>({type:'added',doc:{id:l.id,data:()=>l}}))})};
window.fx.users=getUsersAsync;
function State(){const data=useMobileData();return <output data-testid="leads">{data.leads.map(l=>l.id).join(',')}</output>}
createRoot(document.getElementById('root')).render(<MobileDataBoundary><Page/><State/></MobileDataBoundary>);
`;
const bundle = await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: root }, bundle: true,
  write: false, format: 'esm', define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_NATIVE_BUILD': '"1"' },
  plugins: [{ name: 'fixtures', setup(b) {
    b.onResolve({ filter: /.*/ }, a => mocks[a.path] ? { path: a.path, namespace: 'mock' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ contents: mocks[a.path], loader: 'tsx', resolveDir: root }));
  } }],
});
const server = createServer((req,res) => {
  if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}
  else res.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
  browser = await chromium.launch({ executablePath: '/tmp/raydar-browser/chromium', args: ['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage'] });
  const page = await browser.newPage({viewport:{width:393,height:852}}), errors=[], remote=[], logs=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>logs.push(m.text()));
  await page.route('**/*',r=>{if(new URL(r.request().url()).hostname==='127.0.0.1')return r.continue();remote.push(r.request().url());return r.abort();});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
  assert.deepEqual(await page.evaluate(()=>[window.fx.profileReads,window.fx.goalReads,window.fx.directoryReads,window.fx.subscriptions.length]),[1,1,0,1]);
  const deliver = () => page.evaluate(()=> {
    const s=window.fx.subscriptions.findLast(s=>s.active);
    s.next(window.fx.snapshot([{id:'roof-1',status:'not-home',dispositionedAt:new Date(),dispositionHistory:[{userId:'test-rep'}]}]));
  });
  await deliver();await expect(page.getByTestId('leads')).toHaveText('roof-1');await expect(page.getByTestId('target')).toHaveText('9');
  await page.evaluate(()=>window.fx.subscriptions.findLast(s=>s.active).error({code:'permission-denied',message:'PRIVATE_DETAILS'}));
  await expect(page.locator('div[role=status]')).toContainText('permission-denied');await expect(page.getByTestId('leads')).toHaveText('');
  assert.equal(await page.evaluate(()=>window.fx.subscriptions.filter(s=>s.active).length),0);
  await page.getByRole('button',{name:'Retry data'}).click();
  await expect.poll(()=>page.evaluate(()=>window.fx.subscriptions.length)).toBe(2);
  await deliver();await expect(page.getByTestId('leads')).toHaveText('roof-1');
  await page.evaluate(()=>dispatchEvent(new Event('raydar-network-change')));
  assert.equal(await page.evaluate(()=>window.fx.subscriptions.length),2);
  await page.evaluate(()=>window.fx.subscriptions.findLast(s=>s.active).error({code:'unavailable'}));
  await expect(page.locator('div[role=status]')).toContainText('unavailable');await expect(page.getByTestId('leads')).toHaveText('roof-1');
  await page.evaluate(()=>dispatchEvent(new Event('raydar-network-change')));
  await expect.poll(()=>page.evaluate(()=>window.fx.subscriptions.length)).toBe(3);
  await deliver();await expect(page.getByTestId('leads')).toHaveText('roof-1');
  await page.evaluate(async()=>{window.fx.directoryHang=true;window.fx.twoDirectories=Promise.all([window.fx.users(),window.fx.users()]);});
  await expect.poll(()=>page.evaluate(()=>window.fx.directoryReads)).toBe(1);
  await page.evaluate(async()=>{window.fx.directoryHang=false;window.fx.finishDirectory();await window.fx.twoDirectories;await window.fx.users()});
  assert.deepEqual(await page.evaluate(()=>[window.fx.profileReads,window.fx.directoryReads]),[1,1]);
  await page.evaluate(()=>{window.fx.account={uid:'other-rep'};window.fx.role='setter';window.fx.authListeners.forEach(f=>f())});
  await expect(page.getByTestId('leads')).toHaveText('');
  await expect.poll(()=>page.evaluate(()=>window.fx.subscriptions.filter(s=>s.active).length)).toBe(2);
  assert.deepEqual(await page.evaluate(()=>window.fx.subscriptions.filter(s=>s.active).map(s=>s.q.filters[0])),[['assignedTo','==','other-rep'],['claimedBy','==','other-rep']]);
  await page.evaluate(()=>window.fx.users());assert.equal(await page.evaluate(()=>window.fx.directoryReads),2);
  assert(!logs.join('\n').includes('PRIVATE_DETAILS'));
  assert(logs.some(x=>x.includes('leads-error')&&x.includes('permission-denied')));
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  await writeFile(`${dest}/results.json`,JSON.stringify({oneStartupProfileRead:true,noDuplicateGoalLeadRead:true,noEagerDirectoryRead:true,liveGoalUpdates:true,permissionFailureClearsLeads:true,manualRetryRecovers:true,healthyReconnectKeepsListener:true,transientReconnectRecovers:true,directoryDeduplicatedAndScoped:true,accountSwitchClearsOldLeads:true,errorCodeLoggedWithoutRawMessage:true,remoteRequests:0,errors},null,2));
  console.log('Data loading regressions passed (isolated Chromium, no production requests).');
} finally { await browser?.close();server.close(); }
