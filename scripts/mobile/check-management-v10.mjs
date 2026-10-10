import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const root = process.env.MOBILE_EXPORT_DIR || "out";
const dest =
  process.env.RAYDAR_SCREENSHOTS_DIR || "/tmp/raydar-v10-screenshots";
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

  await page.getByRole("button", { name: /^Choose territory user:/ }).click();
  await expect(page.locator(".rm-person-results button")).toHaveCount(26);
  for (let i = 0; i < 4; i++) {
    await page.locator(".rm-person-results").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.locator(".rm-person-results button")).toHaveCount(25);
  }
  await page.getByLabel("Search users").fill("Taylor");
  await page
    .getByRole("button", { name: "Select Taylor Reed", exact: true })
    .click();
  await expect(page.locator(".rt-area")).toHaveCount(1);
  await expect(page.locator(".rt-area")).toContainText("Maple Street North");
  await page.locator(".rt-area").click();
  await page
    .getByRole("button", { name: "Delete territory", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("No leads are deleted or unassigned");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".rt-area")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Delete territory", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Delete territory", exact: true })
    .click();
  await expect(page.locator(".rt-area")).toHaveCount(0);
  await page.getByRole("button", { name: /^Choose territory user:/ }).click();
  await page.getByLabel("Search users").fill("Jordan");
  await page
    .getByRole("button", { name: "Select Jordan Lee", exact: true })
    .click();
  await expect(page.locator(".rt-area")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Delete all territories", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".rt-area")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Delete all territories", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Delete all territories", exact: true })
    .click();
  await expect(page.locator(".rt-area")).toHaveCount(0);
  await page.goto("http://127.0.0.1:4197/mobile/workspace/users/preview/");
  await expect(page.locator(".rm-user-row")).toHaveCount(30);
  await expect(
    page.getByRole("button", { name: "Your account cannot be deleted" })
  ).toBeDisabled();
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.locator(".rm-user-row")).toHaveCount(30);
  }
  await page.getByLabel("Search accounts").fill("Sample Rep 180");
  await expect(page.locator(".rm-user-row")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Delete Sample Rep 180", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".rm-user-row")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Delete Sample Rep 180", exact: true })
    .click();
  await page.screenshot({ path: `${dest}/Raydar-Delete-User-v10.png` });
  await dialog
    .getByRole("button", { name: "Delete account & territories", exact: true })
    .click();
  await expect(page.locator(".rm-user-row")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Pin history is kept");
  await page.getByLabel("Search accounts").fill("");
  await expect(page.getByText("180 accounts", { exact: true })).toBeVisible();
  for (const size of [
    { width: 360, height: 640 },
    { width: 393, height: 852 },
    { width: 852, height: 393 },
  ]) {
    await page.setViewportSize(size);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      true
    );
  }
  await page.setViewportSize({ width: 393, height: 852 });
  await page.screenshot({ path: `${dest}/Raydar-Manage-Users-v10.png` });
  assert.deepEqual(errors, []);
  assert.deepEqual(apiRequests, []);
  console.log(
    "PASS: 1,003-person territory picker bounded to 25 rows; scrolling, paging, search, per-user areas, single/bulk deletion and cancel; 181-account directory, self protection, delete/cancel, responsive widths; fictional data only."
  );
} finally {
  await browser?.close();
  server.kill();
}
