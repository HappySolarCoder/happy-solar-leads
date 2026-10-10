import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const root = process.env.MOBILE_EXPORT_DIR || "out";
const dest = process.env.RAYDAR_SCREENSHOTS_DIR || "/tmp/raydar-v6-screenshots";
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
  await page.getByRole("button", { name: /Maple Street North Taylor/ }).click();
  await expect(
    page.getByRole("button", { name: "Transfer", exact: true })
  ).toBeVisible();
  await page.screenshot({
    path: `dest-placeholder/Raydar-Territories-v6.png`.replace(
      "dest-placeholder",
      dest
    ),
  });
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Territory name")
    .fill("Maple Morning Route");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Maple Morning Route Taylor/ })
  ).toBeVisible();
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("New rep")
    .selectOption("demo-rep-2");
  await page
    .getByRole("button", { name: "Transfer area", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Maple Morning Route Jordan/ })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove boundary", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove boundary", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Maple Morning Route Jordan/ })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "New area", exact: true }).click();
  await page.getByLabel("Territory name").fill("Oak Lane East");
  await page.getByLabel("Assign to").selectOption("demo-rep");
  const box = await page.locator(".rt-map").boundingBox();
  for (const [x, y] of [
    [0.28, 0.4],
    [0.76, 0.4],
    [0.76, 0.75],
    [0.28, 0.75],
  ])
    await page.touchscreen.tap(box.x + box.width * x, box.y + box.height * y);
  await expect(page.getByText(/4 corners/)).toBeVisible();
  await page.getByRole("button", { name: "Undo corner", exact: true }).click();
  await expect(
    page.locator(".rt-map-hint").filter({ hasText: "3 corners" })
  ).toBeVisible();
  await page.touchscreen.tap(
    box.x + box.width * 0.28,
    box.y + box.height * 0.75
  );
  await page.getByRole("button", { name: "Review pins", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Assign 9 pins", exact: true })
  ).toBeVisible();
  await expect(page.locator(".leaflet-zoom-anim")).toHaveCount(0);
  await page.screenshot({ path: `${dest}/Raydar-Territory-Review-v6.png` });
  await page
    .getByRole("button", { name: "Assign 9 pins", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Oak Lane East Taylor/ })
  ).toBeVisible();
  await page.getByLabel("Search territories").fill("no match");
  await expect(
    page.getByText("No matching areas", { exact: true })
  ).toBeVisible();
  await page.getByLabel("Search territories").fill("");
  await page.getByLabel("Filter by rep").selectOption("demo-rep");
  await expect(
    page.getByRole("button", { name: /Parkside West Jordan/ })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Switch to street map" }).click();
  await expect(
    page.getByRole("button", { name: "Switch to satellite imagery" })
  ).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    ),
    true
  );
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: `${dest}/Raydar-Territories-Desktop-v6.png` });
  assert.deepEqual(errors, []);
  assert.deepEqual(apiRequests, []);
  console.log(
    "PASS: mobile touch drawing, undo, preview, create, rename, transfer, remove boundary, search, rep filter, imagery toggle, desktop layout. Fictional fixtures only; zero API requests."
  );
} finally {
  await browser?.close();
  server.kill();
}
