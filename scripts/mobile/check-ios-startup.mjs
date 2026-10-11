// Actual React login/session components with isolated transports; no company requests.
import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,cp,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const root=process.cwd(),stage='/tmp/raydar-ios-startup',dest='/tmp/raydar-ios-startup-results';
const release=JSON.parse(await readFile(path.join(root,'app/mobile/_lib/release.json'),'utf8'));
await mkdir(stage,{recursive:true});await mkdir(dest,{recursive:true});
const mocks={
 'next/navigation':`import {useSyncExternalStore} from 'react';const listen=f=>{addEventListener('route',f);return()=>removeEventListener('route',f)};export const usePathname=()=>useSyncExternalStore(listen,()=>window.fx.path,()=>'/login');const router={replace:p=>{window.fx.path=p;dispatchEvent(new Event('route'))},push:p=>{window.fx.path=p;dispatchEvent(new Event('route'))}};export const useRouter=()=>router;`,
 'next/link':`import React from 'react';export default ({children,...p})=><a {...p}>{children}</a>;`,
 'next/image':`import React from 'react';export default ({priority,...p})=><img {...p}/>;`,
 '@capacitor/core':`export const Capacitor={isNativePlatform:()=>true,getPlatform:()=>window.fx.platform};export const SystemBars={setStyle:async()=>{}};export const SystemBarsStyle={Light:'light'};`,
 '@capacitor/app':`export const App={addListener:async(name,fn)=>{window.fx.events[name]=fn;return{remove:async()=>{delete window.fx.events[name]}}}};`,
 '@capacitor/network':`export const Network={getStatus:async()=>({connected:window.fx.online}),addListener:async()=>({remove:async()=>{}})};`,
 '@capacitor/splash-screen':`export const SplashScreen={hide:async()=>{}};`,
 '@/app/utils/firebase':`export const auth={get currentUser(){return window.fx.uid?{uid:window.fx.uid}:null}};export const db={};`,
 'firebase/auth':`export const onAuthStateChanged=(a,cb)=>{let alive=true;queueMicrotask(()=>{if(alive&&!window.fx.authHang)cb(a.currentUser)});return()=>{alive=false}};export async function signInWithEmailAndPassword(){window.fx.signIns++;if(window.fx.loginHang)await new Promise(resolve=>window.fx.finishLogin=resolve);if(window.fx.invalid)throw {code:'auth/invalid-credential'};window.fx.uid='test-rep';return {user:{uid:'test-rep'}}};export const fetchSignInMethodsForEmail=async()=>{throw Error('Unexpected sign-in method probe')};`,
 'firebase/firestore':`export const doc=(db,c,id)=>({c,id});export async function getDoc(){window.fx.profileReads++;if(window.fx.profileHang)await new Promise(resolve=>window.fx.finishProfile=resolve);return {exists:()=>!window.fx.missing,data:()=>({name:'Example Rep',role:'setter',approvalStatus:'approved'})}};`,
 '@/app/utils/auth':`export const getCurrentAuthUser=async()=>{throw Error('Native login must not read a duplicate profile')};`,
 '@/app/utils/storage':`export const saveCurrentUser=()=>{throw Error('Native login must not save legacy profile')};`,
 '@/app/hooks/useLiveLeads':`export const useLiveLeads=()=>({leads:[],error:''});`,
 '@/app/utils/dispositions':`export const getDispositionsAsync=async()=>[];export const isScheduledGoBackLead=()=>false;`,
 '@/app/field/useFieldData':`export const useFieldData=()=>({leads:[],drafts:[],retrySync:()=>{},offline:false});`,
 '@/app/field/deviceStore':`export const readArea=async()=>null;`,
};
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {usePathname} from 'next/navigation';import Login from './app/login/page';import {MobileDataBoundary} from './app/mobile/_components/MobileDataProvider';import NativeRuntime from './app/components/NativeRuntime';
window.fx={path:'/login',platform:'ios',uid:null,signIns:0,profileReads:0,online:true,events:{},networkChanges:0};addEventListener('raydar-network-change',()=>window.fx.networkChanges++);
function App(){const p=usePathname();return <><NativeRuntime/>{p==='/login'?<Login/>:<div className="raydar-mobile"><MobileDataBoundary><h1>Workspace ready</h1></MobileDataBoundary></div>}</>};createRoot(document.getElementById('root')).render(<App/>);`;
await build({stdin:{contents:entry,loader:'tsx',resolveDir:root},outfile:path.join(stage,'app.js'),bundle:true,format:'esm',define:{'process.env.NODE_ENV':'"production"','process.env.NEXT_PUBLIC_NATIVE_BUILD':'"1"'},plugins:[{name:'isolated',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:root}));}}]});
await cp(path.join(root,'public/brand'),path.join(stage,'brand'),{recursive:true});
await cp(path.join(root,'out/_next'),path.join(stage,'_next'),{recursive:true});
const css=(await readdir(path.join(stage,'_next/static/css'))).filter(x=>x.endsWith('.css')).map(x=>`<link rel="stylesheet" href="/_next/static/css/${x}">`).join('');
await writeFile(path.join(stage,'index.html'),`<!doctype html><html data-raydar-native="true"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body><div class="native-viewport" id="root"></div><script type="module" src="/app.js"></script></body></html>`);
const server=spawn('python',['-m','http.server','4211','--bind','127.0.0.1','--directory',stage],{stdio:'ignore'});let browser;
try{
 for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:4211')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:'/tmp/raydar-browser/chromium',args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:393,height:852},hasTouch:true});const errors=[],remote=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{if(new URL(r.request().url()).hostname==='127.0.0.1')return r.continue();remote.push(r.request().url());return r.abort();});
 const open=async()=>{await page.goto('http://127.0.0.1:4211');await expect(page.getByRole('button',{name:'Sign In',exact:true})).toBeVisible();};
 const login=async()=>{await page.getByLabel('Email Address').fill('rep@example.invalid');await page.getByLabel('Password',{exact:true}).fill('fixture-only');await page.getByRole('button',{name:'Sign In',exact:true}).click();};
 await open();await expect(page.getByText(`Raydar v${release.version} · build ${release.build}`,{exact:true})).toBeVisible();await expect(page.locator('img[alt="Raydar"]')).toHaveAttribute('src','/brand/raydar-v5/raydar-primary-v5.svg');
 await page.screenshot({path:`${dest}/iphone-login.png`});
 await login();await expect(page.getByRole('heading',{name:'Workspace ready'})).toBeVisible();assert.equal(await page.evaluate(()=>window.fx.profileReads),1);
 const before=await page.evaluate(()=>window.fx.networkChanges);await page.evaluate(()=>window.fx.events.appStateChange({isActive:true}));await expect.poll(()=>page.evaluate(()=>window.fx.networkChanges)).toBe(before+1);
 await open();await page.evaluate(()=>window.fx.profileHang=true);await page.clock.install();await login();await expect(page.getByText('Getting your day ready')).toBeVisible();await page.clock.runFor(12_050);await expect(page.getByText(/Your account profile is taking too long/)).toBeVisible();await page.screenshot({path:`${dest}/iphone-startup-recovery.png`});await page.evaluate(()=>{window.fx.profileHang=false;window.fx.finishProfile()});await expect(page.getByRole('heading',{name:'Workspace ready'})).toHaveCount(0);await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(page.getByRole('heading',{name:'Workspace ready'})).toBeVisible();
 await open();await page.evaluate(()=>window.fx.loginHang=true);await login();await page.clock.runFor(15_050);await expect(page.getByRole('alert')).toContainText('Sign-in is taking longer');await expect(page.getByRole('button',{name:'Reload app'})).toBeVisible();assert.equal(await page.evaluate(()=>window.fx.signIns),1);await page.evaluate(()=>window.fx.finishLogin());await expect(page.getByRole('heading',{name:'Workspace ready'})).toBeVisible();
 await open();await page.evaluate(()=>window.fx.invalid=true);await login();await expect(page.getByRole('alert')).toContainText('Invalid email or password');await expect(page.getByRole('button',{name:'Sign In',exact:true})).toBeEnabled();
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
 await writeFile(`${dest}/results.json`,JSON.stringify({currentBrandAndVersion:true,oneProfileReadAfterLogin:true,profileTimeoutAndRetry:true,lateProfileIgnored:true,signInTimeoutWithoutDuplicateRequest:true,lateSignInRecovers:true,invalidCredentialRecovery:true,nativeResumeEvent:true,liveRequests:0,errors},null,2));console.log('Native startup React regressions passed. Isolated Chromium harness, not Xcode/iPhone.');
}finally{await browser?.close();server.kill();}
