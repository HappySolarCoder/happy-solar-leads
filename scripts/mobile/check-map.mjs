import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
const root = process.cwd();
const route = path.join(root, "app/mobile/map-check");
const port = 4191;
let server, browser;
let createdRoute = false;
try {
  await mkdir(route);
  createdRoute = true;
  await cp(
    path.join(root, "tests/fixtures/map-performance/page.tsx"),
    path.join(route, "page.tsx"),
  );
  server = spawn(
    process.execPath,
    [
      path.join(root, "node_modules/next/dist/bin/next"),
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "-p",
      String(port),
    ],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NEXT_PUBLIC_FIREBASE_API_KEY: "",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  );
  let startupLog = "";
  server.stdout.on("data", (chunk) => {
    startupLog += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    startupLog += chunk.toString();
  });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw Error(startupLog);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mobile/map-check`, {
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({
    headless: true,
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
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Test only local code: no tiles, company data, credentials, or external API calls.
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  const start = performance.now();
  await page.goto(`http://127.0.0.1:${port}/mobile/map-check`);
  const center = page.locator('.field-pin[title^="Door 5050"]');
  await center.waitFor({ timeout: 60000 });
  const firstPinMs = Math.round(performance.now() - start);
  await page.waitForTimeout(1500);
  const count = await page.locator(".field-pin").count();
  if (count < 5 || count > 1000)
    throw Error(`Expected viewport subset of 10,000 pins, got ${count}`);
  await page.evaluate(() => {
    window.__pins = Array.from(document.querySelectorAll(".field-pin"));
    window.__center = document.querySelector('.field-pin[title^="Door 5050"]');
    window.__src = window.__center.querySelector("img").src;
  });
  await page.getByRole("button", { name: "GPS tick", exact: true }).click();
  await page.waitForTimeout(500);
  if (
    !(await page.evaluate(() => window.__pins.every((pin) => pin.isConnected)))
  )
    throw Error("GPS tick replaced marker elements");
  await page
    .getByRole("button", { name: "Outcome update", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector('.field-pin[title^="Door 5050"]')
      ?.getAttribute("title")
      ?.includes("Sold"),
  );
  const changed = await page.evaluate(() => ({
    same:
      window.__center ===
      document.querySelector('.field-pin[title^="Door 5050"]'),
    newIcon: window.__center.querySelector("img").src !== window.__src,
    retained: window.__pins.every((pin) => pin.isConnected),
  }));
  if (!changed.same || !changed.newIcon || !changed.retained)
    throw Error("Outcome update did not reuse markers");
  await center.click();
  await page.getByText("5050", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await center.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Pan", exact: true }).click();
  await page.waitForTimeout(1500);
  if (!(await page.locator(".field-pin").count()))
    throw Error("Pan lost all pins");
  await page.locator(".leaflet-control-zoom-out").click();
  await page.waitForTimeout(400);
  await page.locator(".leaflet-control-zoom-out").click();
  await page.locator(".field-cluster").first().waitFor({ timeout: 20000 });
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    JSON.stringify({
      dataset: 10000,
      renderedAtInitialViewport: count,
      firstPinMs,
      checks: [
        "GPS reuses DOM pins",
        "one GHL update changes one icon without replacing pins",
        "latest lead click",
        "removed pin disappears",
        "pan loads next viewport",
        "zoomed-out pin clusters",
      ],
      browserErrors: errors,
    }),
  );
} finally {
  await browser?.close();
  if (createdRoute) {
    await rm(path.join(route, "page.tsx"), { force: true });
    await import("node:fs/promises").then((fs) => fs.rmdir(route));
    await rm(path.join(root, ".next/dev/types/app/mobile/map-check/page.ts"), {
      force: true,
    });
    await rm(path.join(root, ".next/dev/types/validator.ts"), { force: true });
  }
  server?.kill("SIGTERM");
}
