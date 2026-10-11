// Isolated browser test. Uses fictional coordinates; never reads live Firebase.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = process.cwd();
const out = await mkdtemp(path.join(tmpdir(), 'raydar-cache-v125-'));
await build({
  stdin: { contents: `
    import L from 'leaflet';
    import { readTile, saveTile } from '@/app/homeowners/cache';
    import { HomeownerLoader } from '@/app/homeowners/loader';
    import { parseHomeowner, hashNumber } from '@/app/homeowners/model';
    import { HomeownerCanvas } from '@/app/homeowners/CanvasLayer';
    import { geohashForLocation } from 'geofire-common';
    const map = L.map('map', { zoomControl: false, attributionControl: false,
      zoomAnimation: false }).setView([43.152, -77.602], 18);
    const layer = new HomeownerCanvas(() => {}).addTo(map);
    window.cacheHarness = { readTile, saveTile, HomeownerLoader, parseHomeowner,
      hashNumber, geohashForLocation, map, layer };
  `, resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'browser', outfile: path.join(out, 'app.js'),
  alias: { '@': root },
});
const css = await readFile('node_modules/leaflet/dist/leaflet.css', 'utf8');
const html = `<!doctype html><style>${css}body{margin:0}#map{width:393px;height:740px}</style><div id="map"></div>`;
const js = await readFile(path.join(out, 'app.js'));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/app.js' ? js : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    args: ['--no-sandbox', '--no-zygote', '--single-process', '--disable-gpu', '--disable-software-rasterizer', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 393, height: 740 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], remoteRequests = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    remoteRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto(origin);
  await page.evaluate(async () => {
    const seed = (name, stores, fill) => new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => stores.forEach(s => r.result.createObjectStore(s));
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const db = r.result, tx = db.transaction(stores, 'readwrite');
        fill(tx);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    await seed('raydar-homeowners-v12', ['tiles', 'meta'], tx => {
      for (const account of ['account-one', 'account-two']) {
        const id = `fixture:${account}:dr8v4`;
        tx.objectStore('tiles').put({ tile: 'dr8v4', docs: { stale: { lat: 43.1, lng: -77.7 } },
          receipts: [{ lo: 0, hi: 32 ** 9, complete: true, at: Date.now(), zoom: 17 }], touched: Date.now() }, id);
        tx.objectStore('meta').put({ id, bytes: 500, docs: 1, touched: Date.now() }, id);
      }
    });
    await seed('raydar-field-v11', ['outbox'], tx => tx.objectStore('outbox').put({ pending: true }, 'keep-work'));
    localStorage.setItem('raydar_current_user_id', 'keep-user');
  });
  await page.addScriptTag({ url: `${origin}/app.js` });
  const migrated = await page.evaluate(async () => {
    const h = window.cacheHarness;
    const first = await h.readTile('fixture:account-one', 'dr8v4');
    const inspect = (name, store) => new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const db = r.result, q = db.transaction(store).objectStore(store).getAll();
        q.onsuccess = () => { resolve({ version: db.version, values: q.result }); db.close(); };
        q.onerror = () => reject(q.error);
      };
    });
    return { first, tiles: await inspect('raydar-homeowners-v12', 'tiles'),
      meta: await inspect('raydar-homeowners-v12', 'meta'),
      work: await inspect('raydar-field-v11', 'outbox'), user: localStorage.getItem('raydar_current_user_id') };
  });
  assert.equal(migrated.tiles.version, 2);
  assert.deepEqual(migrated.tiles.values, []);
  assert.deepEqual(migrated.meta.values, []);
  assert.deepEqual(migrated.first.docs, {});
  assert.deepEqual(migrated.first.receipts, []);
  assert.deepEqual(migrated.work.values, [{ pending: true }]);
  assert.equal(migrated.user, 'keep-user');

  async function load(offline = false) {
    return page.evaluate(async offline => {
      const h = window.cacheHarness, lat = 43.152, lng = -77.602;
      const hash = h.geohashForLocation([lat, lng], 9);
      const corrected = h.parseHomeowner('fixture-coordinate-correction', {
        address: '100 Example St', municipality: 'Rochester', state: 'NY',
        lat, lng, geohash: hash, geohash5: hash.slice(0, 5),
        latOriginal: 43.153, lngOriginal: -77.6035,
        geohashOriginal: h.geohashForLocation([43.153, -77.6035], 9),
        coordSource: 'nys_address_point',
      });
      let fetches = 0;
      const emitted = [];
      const loader = new h.HomeownerLoader({
        read: tile => h.readTile('fixture:account-one', tile),
        save: tile => h.saveTile('fixture:account-one', tile),
        online: () => !offline,
        fetch: async range => {
          fetches++;
          const n = h.hashNumber(corrected.geohash);
          const docs = n >= range.lo && n < range.hi ? [corrected] : [];
          return { docs, rawCount: docs.length };
        },
      });
      const result = await new Promise(resolve => loader.request({
        south: 43.15, north: 43.154, west: -77.605, east: -77.6, zoom: 17,
      }, state => {
        emitted.push(...state.homes);
        if (!state.loading) resolve(state);
      }));
      return { fetches, result, emitted };
    }, offline);
  }
  const first = await load();
  assert.ok(first.fetches > 0 && first.fetches <= 12);
  assert.ok(first.result.reads <= 2000);
  assert.equal(first.result.homes.length, 1);
  assert.equal(first.result.homes[0].lat, 43.152);
  assert.equal(first.result.homes[0].lng, -77.602);
  assert.ok(first.emitted.every(h => h.lat === 43.152 && h.lng === -77.602));
  const drawing = await page.evaluate(async corrected => {
    const { layer, map } = window.cacheHarness;
    const old = { ...corrected, lat: 43.153, lng: -77.6035 };
    const settle = () => new Promise(resolve => setTimeout(resolve, 100));
    layer.update([old]); await settle();
    layer.update([corrected]); await settle();
    const point = map.latLngToContainerPoint([corrected.lat, corrected.lng]);
    const oldPoint = map.latLngToContainerPoint([old.lat, old.lng]);
    const canvas = document.querySelector('.raydar-homeowner-canvas'), dpr = canvas.width / 393;
    const alpha = canvas.getContext('2d').getImageData(Math.round(point.x * dpr), Math.round(point.y * dpr), 1, 1).data[3];
    return { hit: layer.hitTest(point)?.home.id, oldHit: !!layer.hitTest(oldPoint), alpha };
  }, first.result.homes[0]);
  assert.equal(drawing.hit, 'fixture-coordinate-correction');
  assert.equal(drawing.oldHit, false);
  assert.ok(drawing.alpha > 0, 'corrected location must actually be painted');

  await page.reload();
  await page.addScriptTag({ url: `${origin}/app.js` });
  const repeat = await load();
  assert.equal(repeat.fetches, 0, 'migration must not repeat on relaunch');
  assert.deepEqual(repeat.result.homes, first.result.homes);
  const offline = await load(true);
  assert.equal(offline.fetches, 0);
  assert.deepEqual(offline.result.homes, first.result.homes);
  assert.deepEqual(errors, []);
  assert.deepEqual(remoteRequests, []);
  const results = { version: '12.5', browserMigration: true, allAccountCachesCleared: true,
    receiptsCleared: true, pendingWorkPreserved: true, firstViewportQueries: first.fetches,
    repeatViewportQueries: repeat.fetches, offlineQueries: offline.fetches,
    correctedCoordinateDrawing: drawing, liveFirebaseReads: 0, remoteRequests, errors };
  await writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ...results, output: out }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
