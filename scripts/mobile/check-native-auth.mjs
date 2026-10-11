// Real Firebase Auth SDK + our initializer, with all remote requests intercepted.
// An iPhone user agent exercises Firebase's proactive browser resolver branch.
// This is a Chromium regression test, not a claim of physical iPhone validation.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const root = process.cwd();
const stage = '/tmp/raydar-native-auth';
await mkdir(stage, { recursive: true });
const entry = `
import { initializeApp } from 'firebase/app';
import { initializeAuth, browserLocalPersistence, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { initializeClientAuth } from './app/utils/firebaseAuth';
const p = new URLSearchParams(location.search);
const app = initializeApp({apiKey:'fixture-api-key',authDomain:'fixture.invalid',projectId:'fixture-only'}, p.get('name') || 'native-auth-test');
const startedAt = performance.now();
window.fx = {ready:false,uid:null,readyMs:null,error:null};
const auth = p.get('legacyLocal') === '1'
  ? initializeAuth(app, {persistence:browserLocalPersistence})
  : initializeClientAuth(app, p.get('native') !== '0', p.get('platform') || 'ios');
onAuthStateChanged(auth, u => {window.fx.ready=true;window.fx.uid=u?.uid || null;window.fx.readyMs=performance.now()-startedAt;});
window.fx.login = async password => {
  try {await signInWithEmailAndPassword(auth, 'rep@example.invalid', password);return 'ok';}
  catch(e) {window.fx.error=e.code;return e.code;}
};
window.fx.logout = () => signOut(auth);
window.fx.reinitialize = () => initializeClientAuth(app, true, 'ios') === auth;
`;
await build({ stdin: { contents: entry, loader: 'ts', resolveDir: root },
  outfile: path.join(stage, 'app.js'), bundle: true, format: 'esm',
  define: { 'process.env.NODE_ENV': '"production"' } });
const js = await readFile(path.join(stage, 'app.js'));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url?.startsWith('/app.js') ? 'application/javascript' : 'text/html');
  res.end(req.url?.startsWith('/app.js') ? js : '<!doctype html><html><body><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const sdkVersion = JSON.parse(await readFile(path.join(root, 'node_modules/firebase/package.json'), 'utf8')).version;
let browser;
const results = { sdkVersion, engine: 'Chromium with iPhone user agent; remote Auth responses are fixtures', liveRequests: 0 };
try {
  browser = await chromium.launch({ executablePath: process.env.RAYDAR_CHROMIUM || '/tmp/raydar-browser/chromium',
    args: ['--no-sandbox', '--no-zygote', '--single-process', '--disable-gpu', '--disable-software-rasterizer', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' });
  const requests = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const now = Math.floor(Date.now() / 1000);
  const token = [ {alg:'none',typ:'JWT'}, {sub:'fixture-rep',user_id:'fixture-rep',iat:now,auth_time:now,exp:now+3600,aud:'fixture-only',iss:'https://securetoken.google.com/fixture-only'} ]
    .map(part => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.') + '.fixture';
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    requests.push(url.hostname + url.pathname);
    if (url.hostname === 'apis.google.com') {
      // The unused browser resolver never receives its callback. No network leaves this test.
      return route.fulfill({ contentType: 'application/javascript', body: '' });
    }
    if (url.hostname === 'identitytoolkit.googleapis.com') {
      if (url.pathname.endsWith('accounts:signInWithPassword')) {
        const body = request.postDataJSON();
        if (body.password === 'wrong') return route.fulfill({ status: 400, json: {error:{code:400,message:'INVALID_LOGIN_CREDENTIALS'}} });
        return route.fulfill({ json: {localId:'fixture-rep',email:'rep@example.invalid',idToken:token,refreshToken:'fixture-refresh',expiresIn:'3600',registered:true} });
      }
      if (url.pathname.endsWith('accounts:lookup')) return route.fulfill({ json: {users:[{localId:'fixture-rep',email:'rep@example.invalid',emailVerified:true,passwordUpdatedAt:now*1000,providerUserInfo:[{providerId:'password',email:'rep@example.invalid'}],createdAt:String(now*1000),lastLoginAt:String(now*1000)}]} });
    }
    throw Error(`Unexpected remote request was blocked: ${url.hostname}${url.pathname}`);
  });
  const open = async query => { await page.goto(origin + '/?' + query); await page.waitForFunction(() => !!window.fx?.login); };
  const ready = () => expect.poll(() => page.evaluate(() => window.fx.ready), {timeout:5000}).toBe(true);
  const popupRequests = () => requests.filter(request => request.startsWith('apis.google.com/')).length;

  await open('native=0&name=browser-baseline');
  await expect.poll(popupRequests).toBe(1);
  await page.clock.install();
  await page.clock.runFor(12_100);
  assert.equal(await page.evaluate(() => window.fx.ready), false);
  results.oldBrowserInitializerStallsPastSessionDeadline = true;
  await page.clock.resume();

  requests.length = 0;
  await open('platform=ios'); await ready();
  assert.equal(await page.evaluate(() => window.fx.uid), null);
  assert.equal(requests.length, 0);
  assert.equal(await page.evaluate(() => window.fx.reinitialize()), true);
  results.freshIPhoneSessionReadyMs = Math.round(await page.evaluate(() => window.fx.readyMs));
  assert.equal(await page.evaluate(() => window.fx.login('wrong')), 'auth/invalid-credential');
  assert.equal(await page.evaluate(() => window.fx.login('fixture-password')), 'ok');
  await expect.poll(() => page.evaluate(() => window.fx.uid)).toBe('fixture-rep');
  await page.reload(); await ready();
  assert.equal(await page.evaluate(() => window.fx.uid), 'fixture-rep');
  results.emailPasswordAndIndexedDBSessionRestore = true;
  await page.evaluate(() => window.fx.logout());
  await page.reload(); await ready();
  assert.equal(await page.evaluate(() => window.fx.uid), null);
  results.signOutPersists = true;

  await open('legacyLocal=1&name=local-migration'); await ready();
  await page.evaluate(() => window.fx.login('fixture-password'));
  await open('platform=ios&name=local-migration'); await ready();
  assert.equal(await page.evaluate(() => window.fx.uid), 'fixture-rep');
  results.existingLocalStorageSessionRetained = true;
  await open('platform=android&name=local-migration'); await ready();
  assert.equal(await page.evaluate(() => window.fx.uid), 'fixture-rep');
  results.androidSessionRestore = true;
  assert.equal(popupRequests(), 0);
  assert.deepEqual(errors, []);
  results.nativePopupRequests = 0;
  results.errors = errors;
  await writeFile(path.join(stage, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
