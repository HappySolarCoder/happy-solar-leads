import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const root = process.cwd(),
  stage = "/tmp/raydar-v7-pins";
await mkdir(stage, { recursive: true });
const mocks = {
  "@/app/utils/firebase": `export const auth={currentUser:{getIdToken:async()=>''}};export const db=null;`,
  "@/app/utils/dispositions": `export * from '@/app/types/disposition';export const getDispositionsAsync=()=>new Promise(resolve=>{window.fx.resolveSettings=resolve});`,
  "@/app/utils/storage": `const write=async()=>{window.fx.writes++;throw new Error('Unexpected write')};export const updateLeadStatus=write,claimLead=write,unclaimLead=write,updateLeadAsync=write,saveLeadAsync=write;export const getUsersAsync=async()=>[];`,
  "@/app/utils/territories": `export const getTerritoriesAsync=async()=>[];`,
  "@/app/utils/apiFetch": `export async function apiFetch(path,init){window.fx.requests.push({path,method:init?.method||'GET'});return new Response('{}',{status:200})}`,
  "@/app/utils/easterEggs": `export const checkEasterEggTrigger=async()=>null;`,
  "@/app/utils/solarMadness": `export const awardSolarMadnessAsync=async()=>null;`,
  "@/app/utils/geolocation": `export const getLocation=async()=>null;export const watchLocation=async()=>()=>{};`,
};
const empty =
  /\/(AddLeadModal|ObjectionTracker|LeadEditorModal|SolarMadnessWinModal|EasterEggWinModal|GoBackScheduleModal)$/;
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import L from 'leaflet';import LeadMap from './app/components/LeadMap';import LeadDetail from './app/components/LeadDetail';import {DEFAULT_DISPOSITIONS} from './app/types/disposition';import './app/mobile/mobile.css';
window.fx={writes:0,requests:[],selections:[]};const orig=L.map;L.map=(...args)=>{const map=orig(...args);window.fx.map=map;return map};
const user={id:'rep',name:'Sample Rep',role:'setter',features:{proximityEnforcement:false}};
const initial=[{id:'red',name:'Red Test Lead',address:'128 Meadow Lane',city:'Rochester',state:'NY',zip:'14618',lat:43.1566,lng:-77.6088,status:'do-not-knock',assignedTo:'rep',createdAt:new Date(),notes:'Keep this note'},{id:'warm',name:'Warm Test Lead',address:'130 Meadow Lane',city:'Rochester',state:'NY',zip:'14618',lat:43.1568,lng:-77.6084,status:'unclaimed',assignedTo:'rep',solarScore:90,solarCategory:'great',createdAt:new Date()}];
const leads=initial.map(l=>Object.freeze(l));const before=JSON.stringify(leads);window.fx.unchanged=()=>JSON.stringify(leads)===before;
function App(){const [selected,setSelected]=React.useState(null),[data,setData]=React.useState(leads);window.fx.refresh=()=>setData(leads.map(l=>({...l})));
return <div className="raydar-mobile"><div className="rm-field-shell"><p>Cached / online fixture</p><main className="rm-knocking-map" style={{flex:1,position:'relative'}}><LeadMap leads={data} dispositionOptions={DEFAULT_DISPOSITIONS} currentUser={user} userPosition={[43.1561,-77.6098]} center={[43.1566,-77.6088]} zoom={18} selectedLeadId={selected?.id} onLeadClick={lead=>{window.fx.selections.push(lead.id);setSelected(lead)}}/></main>{selected&&<LeadDetail lead={selected} currentUser={user} fieldMemory onClose={()=>setSelected(null)} onUpdate={()=>{window.fx.writes++}}/>}</div></div>}
createRoot(document.getElementById('root')).render(<App/>);`;
await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  outfile: path.join(stage, "app.js"),
  format: "esm",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "fixture",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) =>
          mocks[args.path]
            ? { path: args.path, namespace: "fixture" }
            : empty.test(args.path)
            ? { path: args.path, namespace: "empty" }
            : undefined
        );
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
// Production Tailwind styles are copied from the static export for the real panel.
const html = await readFile(
  (process.env.MOBILE_EXPORT_DIR || "/tmp/raydar-v7-out") +
    "/mobile/index.html",
  "utf8"
);
const styles = [...html.matchAll(/href="([^\"]+\.css(?:\?[^\"]*)?)"/g)].map(
  (m) => m[1]
);
let css = "";
for (const style of styles)
  css += await readFile(
    (process.env.MOBILE_EXPORT_DIR || "/tmp/raydar-v7-out") +
      style.split("?")[0],
    "utf8"
  );
await writeFile(path.join(stage, "production.css"), css);
await writeFile(
  path.join(stage, "index.html"),
  `<!doctype html><html data-native="android"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="production.css"><link rel="stylesheet" href="app.css"></head><body style="margin:0"><div class="native-viewport"><div id="root"></div></div><script type="module" src="app.js"></script></body></html>`
);
const server = spawn(
  "python",
  ["-m", "http.server", "4199", "--bind", "127.0.0.1", "--directory", stage],
  { stdio: "ignore" }
);
let browser;
try {
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch("http://127.0.0.1:4199")).ok) break;
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
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "block",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (r) => {
    if (new URL(r.request().url()).hostname === "127.0.0.1")
      return r.continue();
    return r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#d7e2d2"/></svg>',
    });
  });
  await page.goto("http://127.0.0.1:4199");
  const pin = page.locator('.field-pin[title^="128 Meadow Lane"]');
  await expect(pin).toBeVisible();
  await pin.evaluate((el) => {
    window.fx.originalMarker = el;
    window.fx.originalImage = el.querySelector("img");
  });
  await pin.tap();
  await expect(page.locator(".rm-lead-detail")).toBeVisible();
  console.log(
    "after tap",
    JSON.stringify(
      await page.evaluate(() => ({
        errors: window.fx.errors,
        writes: fx.writes,
        selections: fx.selections,
        pins: document.querySelectorAll(".field-pin").length,
        requests: fx.requests,
      }))
    )
  );
  await expect(pin).toBeAttached();
  assert.equal(
    await pin.evaluate(
      (el) =>
        el === window.fx.originalMarker &&
        el.querySelector("img") === window.fx.originalImage
    ),
    true,
    "selection must preserve the marker and image DOM"
  );
  // Even when settings do not return, the selected cached lead must be readable/closable.
  await expect(
    page.locator(".rm-lead-detail").getByText("Red Test Lead", { exact: true })
  ).toBeVisible({ timeout: 3000 });
  await page.getByRole("button", { name: "Close lead details" }).click();
  await expect(pin).toBeVisible();
  for (const online of [false, true]) {
    await page.context().setOffline(!online);
    await pin.tap();
    await expect(
      page
        .locator(".rm-lead-detail")
        .getByText("Red Test Lead", { exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: "Close lead details" }).click();
    await page.evaluate(() => {
      fx.refresh();
      fx.map.panBy([8, 8], { animate: false });
      fx.map.setZoom(17, { animate: false });
    });
    await expect(pin).toBeVisible();
    assert.equal(
      await pin
        .locator("img")
        .evaluate((el) => el.complete && el.naturalWidth > 0),
      true
    );
  }
  assert.equal(await page.evaluate(() => fx.writes), 0);
  assert.equal(await page.evaluate(() => fx.unchanged()), true);
  assert.deepEqual(
    await page.evaluate(() => fx.requests.filter((r) => r.method !== "GET")),
    []
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: actual LeadMap + LeadDetail touch selection without replacing marker/image DOM, visible marker after closing/zoom/pan/new snapshot, cached and online states, zero writes, immutable lead unchanged."
  );
} finally {
  await browser?.close();
  server.kill();
}
