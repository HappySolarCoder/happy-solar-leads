// Isolated browser regression: production components + fake Firebase transport.
// Never reads or writes company records. Also exercises real Leaflet resize behavior.
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdir, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const root = process.cwd();
const stage = "/tmp/raydar-v7-regression";
const dest = process.env.RAYDAR_SCREENSHOTS_DIR || "/tmp/raydar-v7-screenshots";
await mkdir(stage, { recursive: true });
await mkdir(dest, { recursive: true });
const mocks = {
  "next/navigation": `import {useSyncExternalStore} from 'react';
    const subscribe=f=>{addEventListener('fixture-route',f);return()=>removeEventListener('fixture-route',f)};
    export const usePathname=()=>useSyncExternalStore(subscribe,()=>window.fx.path,()=>'/mobile');
    const go=path=>{window.fx.path=path;dispatchEvent(new Event('fixture-route'))};
    const router={push:go,replace:go}; export const useRouter=()=>router;`,
  "next/link": `import React from 'react';import {useRouter} from 'next/navigation';export default function Link({href,children,...props}){const router=useRouter();return <a href={href} {...props} onClick={e=>{e.preventDefault();router.push(href)}}>{children}</a>}`,
  "next/image": `import React from 'react';export default function Image({priority,unoptimized,fill,...props}){return <img {...props}/>}`,
  "next/dynamic": `export default ()=>()=>null;`,
  "@/app/utils/firebase": `export const auth={};export const db={};`,
  "@/app/utils/auth": `export const signOut=async()=>window.fx.auth(null);`,
  "firebase/auth": `export function onAuthStateChanged(_,next){window.fx.authStarts++;window.fx.auth=id=>next(id?{uid:id}:null);queueMicrotask(()=>window.fx.auth(window.fx.user));return()=>{window.fx.authStops++}}`,
  "firebase/firestore": `export const doc=(_,collection,id)=>({collection,id});
    export async function getDoc({id}){window.fx.profileReads++;return {exists:()=>true,data:()=>({name:id==='alice'?'Alex Field':'Sam Field',role:'setter',approvalStatus:'approved'})}}
    export const collection=(_,name)=>({name});export const where=(field,op,value)=>({field,op,value});export const query=(source,...filters)=>({source,filters});
    export function onSnapshot(query,options,next,error){const entry={query,next,error,active:true};window.fx.listeners.push(entry);window.fx.leadStarts++;return()=>{entry.active=false;window.fx.leadStops++}}`,
  "@/app/utils/firestore": `export const mapLeadDoc=s=>({...s.data(),id:s.id});`,
  "@/app/utils/dispositions": `import {DEFAULT_DISPOSITIONS} from '@/app/types/disposition';export const isScheduledGoBackLead=l=>l.status==='go-back';export const getDispositionsAsync=()=>new Promise(resolve=>{window.fx.settingsReads++;window.fx.settings=()=>resolve(DEFAULT_DISPOSITIONS)});`,
  "@/app/utils/goals": `export const getMyGoalViaApiAsync=async()=>null;export const getMyMonthlyKnocksAsync=async()=>0;export const countWorkdaysElapsedAndRemaining=()=>({remaining:10});`,
};
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import {usePathname} from 'next/navigation';
import {MobileDataBoundary,useMobileData} from './app/mobile/_components/MobileDataProvider';
import MobilePage from './app/mobile/page';import FollowUpsPage from './app/mobile/follow-ups/page';import MobileStatsPage from './app/mobile/stats/page';
import {MobileHeader,MobileNav,MobileNotice,FieldToolbar} from './app/mobile/_components/MobileShell';
import {observeMapSize} from './app/utils/observeMapSize';import L from 'leaflet';
import './app/mobile/mobile.css';import 'leaflet/dist/leaflet.css';
window.fx={path:'/mobile',user:'alice',authStarts:0,authStops:0,profileReads:0,settingsReads:0,leadStarts:0,leadStops:0,listeners:[],
 deliver(leads,cached=false){for(const x of this.listeners.filter(x=>x.active)){const filtered=leads.filter(l=>x.query.filters.every(f=>l[f.field]===f.value));x.next({docChanges:()=>filtered.map(l=>({type:'added',doc:{id:l.id,data:()=>l}})),metadata:{fromCache:cached}})}}};
function Probe(){const d=useMobileData();const [banner,setBanner]=React.useState(true);const mapRef=React.useRef(null);
 React.useEffect(()=>{if(!mapRef.current)return;const map=L.map(mapRef.current,{center:[43.15,-77.6],zoom:17});
 const Grid=L.GridLayer.extend({createTile(){const tile=document.createElement('div');tile.style.cssText='background:#cbdbe5;border:1px solid #a5bac8';tile.textContent='MAP TEST TILE';return tile}});new Grid().addTo(map);
 window.fx.map=map;const stop=observeMapSize(map);return()=>{stop();map.remove()}},[]);
 return <div className="rm-field-shell"><FieldToolbar mode="map" onMode={()=>{}} onSearch={()=>{}} onFilter={()=>{}} filterCount={0} gpsError={false} gpsLoading={false} knocks={d.dataLoading?undefined:0} onLocate={()=>{}}/>
 {banner&&<MobileNotice>Checking for latest outcomes.</MobileNotice>}<main className="rm-knocking-map" style={{flex:1,position:'relative'}}><div ref={mapRef} style={{height:'100%',width:'100%'}}/><button id="remove-banner" style={{position:'absolute',top:10,right:10,zIndex:500,background:'white'}} onClick={()=>setBanner(false)}>Hide status</button></main><MobileNav/></div>}
function More(){const d=useMobileData();return <div className="rm-shell"><MobileHeader name={d.user.name}/><main className="rm-content"><h1>Workspace</h1><p>Account tools are ready.</p><button onClick={()=>window.fx.auth(null)}>Sign out</button></main><MobileNav/></div>}
function Screens(){const path=usePathname();return path==='/mobile'?<MobilePage/>:path==='/mobile/follow-ups'?<FollowUpsPage/>:path==='/mobile/stats'?<MobileStatsPage/>:path==='/mobile/knocking'?<Probe/>:<More/>}
function App(){const path=usePathname();return path==='/login'?<p>Signed out</p>:<MobileDataBoundary><Screens/></MobileDataBoundary>}
createRoot(document.getElementById('root')).render(<App/>);`;
await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  outfile: path.join(stage, "app.js"),
  format: "esm",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "fixtures",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          if (mocks[args.path])
            return { path: args.path, namespace: "fixture" };
          if (args.path === "@/app/components/LeadDetail")
            return { path: "detail", namespace: "empty" };
          return undefined;
        });
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: mocks[args.path],
          loader: "tsx",
          resolveDir: root,
        }));
        b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({
          contents: "export default ()=>null;",
          loader: "js",
        }));
      },
    },
  ],
  loader: { ".png": "dataurl" },
  logLevel: "warning",
});
await cp(path.join(root, "public/brand"), path.join(stage, "brand"), {
  recursive: true,
});
await writeFile(
  path.join(stage, "index.html"),
  `<!doctype html><html data-native="android"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><style>
*{box-sizing:border-box}body{margin:0}button,a{font:inherit;color:inherit}button{border:0;background:transparent}a{text-decoration:none}h1,h2,p{margin:0}svg{flex-shrink:0}
html{--app-top:28px;--app-bottom:24px;--app-height:calc(100dvh - var(--app-top) - var(--app-bottom))}.native-viewport{position:fixed;top:var(--app-top);bottom:var(--app-bottom);left:0;right:0;overflow:auto;transform:translateZ(0)}
</style></head><body><div class="native-viewport"><div class="raydar-mobile" id="root"></div></div><script type="module" src="app.js"></script></body></html>`
);
const server = spawn(
  "python",
  ["-m", "http.server", "4198", "--bind", "127.0.0.1", "--directory", stage],
  { stdio: "ignore" }
);
let browser;
try {
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch("http://127.0.0.1:4198")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: [
      "--no-sandbox",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-dev-shm-usage",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 393, height: 852 },
    timezoneId: process.env.TEST_TIMEZONE || "America/Phoenix",
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (r) =>
    new URL(r.request().url()).hostname === "127.0.0.1"
      ? r.continue()
      : r.abort()
  );
  await page.goto("http://127.0.0.1:4198");
  await expect(
    page.getByRole("button", { name: /Start knocking/ })
  ).toBeVisible();
  assert.equal(
    await page.locator(".rm-metrics strong").first().textContent(),
    "—"
  );
  await expect(page.getByText("Your follow-ups are clear")).toHaveCount(0);
  const first = await page.evaluate(() => ({
    auth: fx.authStarts,
    profiles: fx.profileReads,
    leads: fx.leadStarts,
    settings: fx.settingsReads,
  }));
  assert.deepEqual(first, { auth: 1, profiles: 1, leads: 2, settings: 1 });
  // Leave lead/settings requests unresolved for a simulated 20 seconds.
  await page.clock.install();
  await page.clock.fastForward(20000);
  await expect(page.getByText("Getting your day ready")).toHaveCount(0);
  await page.screenshot({ path: path.join(dest, "Raydar-Loading-v7.png") });
  for (const name of ["Follow-ups", "Progress", "Knock", "Today"]) {
    await page
      .getByRole("navigation")
      .getByRole("link", { name, exact: true })
      .click();
    await expect(page.getByText("Getting your day ready")).toHaveCount(0);
  }
  assert.deepEqual(
    await page.evaluate(() => ({
      auth: fx.authStarts,
      profiles: fx.profileReads,
      leads: fx.leadStarts,
      settings: fx.settingsReads,
    })),
    first
  );
  await page.getByRole("link", { name: "Open account and tools" }).click();
  await expect(page.getByText("Account tools are ready.")).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Today", exact: true })
    .click();
  await page.evaluate(() => {
    fx.settings();
    fx.deliver([
      {
        id: "a1",
        name: "Sample Homeowner",
        address: "128 Meadow Lane",
        city: "Rochester",
        state: "NY",
        zip: "14618",
        status: "go-back",
        assignedTo: "alice",
        claimedBy: "alice",
        goBackScheduledBy: "alice",
        goBackScheduledDate: new Date(),
        createdAt: new Date(),
      },
    ]);
  });
  await expect(page.locator(".rm-metrics strong").first()).not.toHaveText("—");
  const nav = await page.locator(".rm-nav").boundingBox();
  assert.equal(Math.round(nav.y + nav.height), 828);
  await page
    .locator(".rm-content")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  assert.deepEqual(await page.locator(".rm-nav").boundingBox(), nav);
  const last = await page.locator(".rm-tool-link").boundingBox();
  assert.ok(
    last.y + last.height <= nav.y,
    "last home action must scroll above navigation"
  );
  await page.locator(".rm-content").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: path.join(dest, "Raydar-Home-v7.png") });
  await page.locator(".rm-metrics").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(dest, "Raydar-Home-Activity-v7.png"),
  });
  // Exercise the actual View all target after scrolling; no overlay may intercept it.
  await page.getByRole("link", { name: "View all", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Follow-ups." })
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "Follow-ups", exact: true })
  ).toHaveAttribute("aria-current", "page");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Today", exact: true })
    .click();
  // Native short-screen/landscape scrolling and navigation remain usable.
  for (const viewport of [
    { width: 360, height: 640 },
    { width: 852, height: 393 },
  ]) {
    await page.setViewportSize(viewport);
    await page
      .locator(".rm-content")
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    const n = await page.locator(".rm-nav").boundingBox(),
      end = await page.locator(".rm-tool-link").boundingBox();
    assert.ok(end.y + end.height <= n.y + 1);
    assert.equal(Math.round(n.y + n.height), viewport.height - 24);
  }
  await page.setViewportSize({ width: 393, height: 852 });
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Knock", exact: true })
    .click();
  await page.clock.runFor(100);
  const before = await page.evaluate(() => fx.map.getSize().y);
  await page.locator("#remove-banner").click();
  await page.clock.runFor(400);
  const size = await page.evaluate(() => ({
    leaflet: fx.map.getSize().y,
    actual: fx.map.getContainer().clientHeight,
  }));
  assert.ok(size.actual > before);
  assert.equal(size.leaflet, size.actual);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Today", exact: true })
    .click();
  const timezone = process.env.TEST_TIMEZONE || "America/Phoenix";
  const offset = timezone === "America/Phoenix" ? "-07:00" : "-04:00";
  for (const [time, greeting] of [
    ["11:58:00", "Good morning"],
    ["12:00:00", "Good afternoon"],
    ["17:00:00", "Good evening"],
    ["23:59:50", "Good evening"],
  ]) {
    await page.clock.setSystemTime(new Date("2026-10-09T" + time + offset));
    await page.evaluate(() => dispatchEvent(new Event("focus")));
    await expect(page.locator(".rm-greeting h1")).toContainText(greeting);
    await expect(page.locator(".rm-greeting .rm-eyebrow")).toContainText(
      "Friday, October 9"
    );
  }
  await page.clock.runFor(11000);
  await expect(page.locator(".rm-greeting h1")).toContainText("Good morning");
  await expect(page.locator(".rm-greeting .rm-eyebrow")).toContainText(
    "Saturday, October 10"
  );
  // A changed account must discard all previous leads and use its own queries.
  await page.evaluate(() => fx.auth("bob"));
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Today", exact: true })
    .click();
  await expect(page.getByText("Sam.")).toBeVisible();
  await expect(page.getByText("128 Meadow Lane")).toHaveCount(0);
  assert.equal(
    await page.locator(".rm-metrics strong").first().textContent(),
    "—"
  );
  assert.deepEqual(
    await page.evaluate(() =>
      fx.listeners.filter((x) => x.active).map((x) => x.query.filters[0].value)
    ),
    ["bob", "bob"]
  );
  await page.evaluate(() => {
    fx.settings();
    for (const x of fx.listeners.filter((x) => x.active))
      x.error(new Error("permission-denied"));
  });
  await expect(page.getByText("Your follow-ups are clear")).toHaveCount(0);
  await expect(
    page
      .getByText(
        "Activity is unavailable. Check your connection and account access."
      )
      .first()
  ).toBeAttached();
  await page.evaluate(() => fx.auth(null));
  await expect(page.getByText("Signed out")).toBeVisible();
  assert.equal(
    await page.evaluate(() => fx.listeners.filter((x) => x.active).length),
    0
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: usable shell during 20-second data delay; local greeting/date through noon, 5pm, midnight and resume; View all navigation; one auth/profile/settings load and two scoped lead listeners across tabs; placeholders; native insets/scrolling at 3 viewport sizes; real Leaflet banner resize; account isolation, permission errors and sign-out cleanup. External requests blocked."
  );
} finally {
  await browser?.close();
  server.kill();
}
