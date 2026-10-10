import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const root = process.env.MOBILE_EXPORT_DIR || "out";
const dest = process.env.RAYDAR_SCREENSHOTS_DIR || "/tmp/raydar-v9-screenshots";
await mkdir(dest, { recursive: true });
const server = spawn(
  "python",
  ["-m", "http.server", "4197", "--bind", "127.0.0.1", "--directory", root],
  { stdio: "ignore" }
);
let browser;
// Deliberately labeled test tiles, never presented as real satellite imagery.
const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e7eddf"/><path d="M 0 60 H256 M80 0 V256 M0 220 H256 M224 0 V256" stroke="#fffdf5" stroke-width="14"/><path d="M0 60H256 M80 0V256 M0 220H256 M224 0V256" stroke="#d4dbcc" stroke-width="1"/><g fill="#c5cebb"><rect x="12" y="86" width="44" height="26" rx="4"/><rect x="108" y="86" width="52" height="30" rx="4"/><rect x="175" y="130" width="30" height="45" rx="4"/><rect x="20" y="160" width="38" height="24" rx="4"/><rect x="100" y="166" width="35" height="30" rx="4"/></g><text x="100" y="24" font-size="10" fill="#66765d">DEMO MAP</text></svg>`;
try {
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch("http://127.0.0.1:4197/mobile/territories/preview/")).ok)
        break;
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
    deviceScaleFactor: 2,
    hasTouch: true,
    serviceWorkers: "block",
    reducedMotion: "reduce",
  });
  const errors = [],
    apiRequests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/")) apiRequests.push(url.pathname);
    if (url.hostname === "127.0.0.1") return route.continue();
    if (
      url.hostname.endsWith("arcgisonline.com") ||
      url.hostname.endsWith("openstreetmap.org")
    )
      return route.fulfill({ contentType: "image/svg+xml", body: tile });
    return route.abort();
  });
  await page.goto("http://127.0.0.1:4197/mobile/territories/preview/");
  await expect(page.locator(".leaflet-container")).toBeVisible();

  const sheet=page.locator(".rt-sheet"), map=page.locator(".rt-map");
  const hide=()=>page.getByRole("button",{name:"Hide territory details",exact:true});
  const show=()=>page.getByRole("button",{name:"Show territory details",exact:true});
  const cdp=await page.context().newCDPSession(page);
  async function swipeHandle(down) {
    const b=await page.locator(".rt-sheet-handle").boundingBox();
    const x=b.x+b.width/2,y=b.y+b.height/2;
    await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
    for(let i=1;i<=6;i++) await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x,y:y+(down?1:-1)*i*9}]});
    await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  }
  async function corner(x,y) { const b=await map.boundingBox();await page.touchscreen.tap(b.x+b.width*x,b.y+b.height*y); }
  const original=await map.boundingBox();
  await swipeHandle(true);
  await expect(show()).toHaveAttribute("aria-expanded","false");
  assert.deepEqual(await map.boundingBox(),original,"Swiping does not shrink or recenter map");
  await swipeHandle(false);
  await expect(hide()).toHaveAttribute("aria-expanded","true");
  await page.getByRole("button",{name:"New area",exact:true}).click();
  await expect(show()).toBeVisible();
  await expect(page.getByRole("group",{name:"Boundary tool"})).toBeVisible();
  await expect(page.getByLabel("Territory name")).toBeHidden();
  await corner(.32,.27);await corner(.72,.46);
  await expect(hide()).toBeVisible();
  await expect(page.getByText("4 corners · Boundary ready",{exact:true})).toBeVisible();
  assert.deepEqual(await map.boundingBox(),original,"Completion preserves map dimensions");
  await page.getByLabel("Territory name").fill("Oak Lane Focus");
  await page.getByLabel("Assign to").selectOption("demo-rep");
  await page.getByRole("button",{name:"Redraw boundary",exact:true}).click();
  await expect(show()).toBeVisible();
  await page.getByRole("button",{name:"Corners",exact:true}).click();
  for(const [x,y] of [[.3,.27],[.7,.27],[.7,.47]]) await corner(x,y);
  await expect(page.getByRole("button",{name:"Done",exact:true})).toBeDisabled();
  await corner(.3,.47);
  await expect(show()).toBeVisible();
  await page.getByRole("button",{name:"Done",exact:true}).click();
  await expect(hide()).toBeVisible();
  await expect(page.getByLabel("Territory name")).toHaveValue("Oak Lane Focus");
  await expect(page.getByLabel("Assign to")).toHaveValue("demo-rep");
  await page.getByRole("button",{name:"Redraw boundary",exact:true}).click();
  await page.getByRole("button",{name:"Draw",exact:true}).click();
  const b=await map.boundingBox();
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:b.x+b.width*.3,y:b.y+b.height*.26}]});
  for(const [x,y] of [[.4,.26],[.6,.26],[.7,.28],[.7,.4],[.6,.46],[.4,.46],[.3,.4],[.3,.3]]) await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:b.x+b.width*x,y:b.y+b.height*y}]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await expect(hide()).toBeVisible();
  await expect(page.getByRole("button",{name:"Review pins",exact:true})).toBeEnabled();
  await page.screenshot({path:`${dest}/Raydar-Territory-Ready-v9.png`});
  await page.getByRole("button",{name:"Review pins",exact:true}).click();
  await expect(page.getByRole("button",{name:"Assign 9 pins",exact:true})).toBeVisible();
  await swipeHandle(true);await expect(show()).toBeVisible();
  await show().click();
  await page.getByRole("button",{name:"Assign 9 pins",exact:true}).click();
  await expect(page.getByRole("button",{name:/Oak Lane Focus Taylor/})).toBeVisible();
  await page.getByRole("button",{name:"New area",exact:true}).click();
  // A crossing boundary opens error feedback, never the assignment action.
  await page.getByRole("button",{name:"Corners",exact:true}).click();
  for(const [x,y] of [[.3,.26],[.7,.46],[.3,.46],[.7,.26]]) await corner(x,y);
  await page.getByRole("button",{name:"Done",exact:true}).click();
  await expect(sheet.getByRole("alert")).toContainText("must not cross");
  await expect(page.getByRole("button",{name:"Review pins",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Open full map",exact:true}).click();
  await page.getByRole("button",{name:"Rectangle",exact:true}).click();
  for(const size of [{width:393,height:852},{width:360,height:640},{width:852,height:393}]) {
    await page.setViewportSize(size);
    await expect(show()).toBeVisible();
    const mb=await map.boundingBox(), hb=await page.locator(".rt-sheet-handle").boundingBox(),tb=await page.locator(".rt-map-drawing-tools").boundingBox();
    assert.ok(mb.height>size.height*.6,"Map fills the available screen");
    assert.ok(tb.y+tb.height<=hb.y+1,"Tools stay above sheet handle");
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await page.setViewportSize({width:393,height:852});
  await page.screenshot({path:`${dest}/Raydar-Territory-Full-Map-v9.png`});
  await show().focus();await page.keyboard.press("Enter");
  await expect(hide()).toBeVisible();
  await page.getByRole("button",{name:"Cancel new territory",exact:true}).click();
  await hide().click();
  await page.getByLabel("Town or ZIP code").fill("14618");
  await page.getByRole("button",{name:"Search",exact:true}).click();
  await page.getByRole("button",{name:"Rochester, NY 14618 · Demo",exact:true}).click();
  await page.getByRole("button",{name:"Switch to street map"}).click();
  await expect(page.getByRole("button",{name:"Switch to satellite imagery"})).toBeVisible();
  await page.setViewportSize({width:1440,height:960});
  await expect(page.getByRole("button",{name:"New area",exact:true})).toBeVisible();
  await expect(page.locator(".rt-sheet-handle")).toBeHidden();
  await page.screenshot({path:`${dest}/Raydar-Territory-Desktop-v9.png`});
  assert.deepEqual(errors,[]);assert.deepEqual(apiRequests,[]);
  console.log("PASS: touch swipe down/up, keyboard toggle, fixed full map, rectangle/freehand automatic reopen, Corners Done, preserved name/rep on redraw, review/create, invalid boundary, phone/landscape/desktop layouts, search and imagery; fictional fixtures only.");
} finally {await browser?.close();server.kill();}
