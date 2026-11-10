import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ADDRESS_CHARS, MAX_ROUTE_STOPS } from '../app/utils/googleProxyLimits';
import {
  DEFAULT_UNAUTH_LIMIT,
  CORS_ALLOWED_HEADERS,
  CORS_ALLOWED_ORIGINS,
  MinuteLimiter,
  geocodeGet,
  geocodePost,
  googleProxyMode,
  proxyPreflight,
  proxyRoute,
  routePost,
  scrubKey,
  solarPost,
  type GoogleProxyDeps,
} from '../app/utils/server/googleProxy';

// Fake keys, shaped like Google keys but not real. Built at runtime so no committed file contains a
// literal AIza... string (tests/no-committed-google-keys.test.ts scans every tracked file).
const PREFIX = ['AI', 'za'].join('');
const KEY = [PREFIX, 'SyFAKEfakeFAKEfakeFAKEfakeFAKEfake1'].join('');
const BODY_KEY = [PREFIX, 'SyBODYbodyBODYbodyBODYbodyBODYbod22'].join('');
assert.equal(KEY.length, 39);
assert.equal(BODY_KEY.length, 39);

type Call = { url: string; init?: RequestInit };
let logs: string[] = [];
const realLog = console.log;
const realError = console.error;
beforeEach(() => {
  logs = [];
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
});
afterEach(() => {
  console.log = realLog;
  console.error = realError;
});

function setup(options: {
  env?: Record<string, string>;
  key?: string | undefined;
  google?: (url: string, init?: RequestInit) => Response | Promise<Response>;
  user?: Record<string, unknown>;
  verifyThrows?: unknown;
  now?: () => number;
} = {}) {
  const calls: Call[] = [];
  const deps: GoogleProxyDeps = {
    verifyIdToken: async (token) => {
      if (options.verifyThrows) throw options.verifyThrows;
      if (token === 'web-token') return { uid: 'web1' };
      if (token === 'mobile-token') return { uid: 'mob1' };
      throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' });
    },
    getUser: async () => ({ exists: true, data: options.user ?? { role: 'setter', isActive: true, approved: true } }),
    fetch: (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (options.google) return options.google(url, init);
      if (url.includes('solar.googleapis')) return Response.json({ name: 'buildings/x', solarPotential: { maxArrayPanelsCount: 10 } });
      if (url.includes('routes.googleapis')) return Response.json({ routes: [{ waypointOrder: [1, 0], legs: [{ endAddress: 'B st', distanceMeters: 1000, duration: '120s' }, { endAddress: 'A st', distanceMeters: 500, duration: '60s' }] }] });
      if (url.includes('latlng=')) return Response.json({ status: 'OK', results: [{ formatted_address: '1 Main St' }] });
      return Response.json({ status: 'OK', results: [{ formatted_address: '1 Main St', types: ['street_address'], geometry: { location: { lat: 43.1, lng: -77.6 } } }] });
    }) as typeof fetch,
    apiKey: () => ('key' in options ? options.key : KEY),
    env: options.env ?? {},
    now: options.now ?? (() => 1_000_000),
    limiter: new MinuteLimiter(),
  };
  return { deps, calls };
}

const req = (url: string, init: RequestInit & { headers?: Record<string, string> } = {}) => new Request(`http://localhost${url}`, init);
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  req(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const WEB = { authorization: 'Bearer web-token' };
const MOBILE = { authorization: 'Bearer mobile-token', 'x-raydar-build': '167', 'x-raydar-platform': 'ios' };
const ENFORCE = { GOOGLE_PROXY_AUTH: 'enforce' };

const ALL = {
  geocodeForward: (deps: GoogleProxyDeps, h: Record<string, string> = {}) => geocodeGet(req('/api/geocode?address=1+Main+St', { headers: h }), deps),
  geocodeReverse: (deps: GoogleProxyDeps, h: Record<string, string> = {}) => geocodeGet(req('/api/geocode?lat=43.1&lng=-77.6&reverse=true', { headers: h }), deps),
  geocodePost: (deps: GoogleProxyDeps, h: Record<string, string> = {}) => geocodePost(post('/api/geocode', { address: '1 Main St, Rochester, NY 14618' }, h), deps),
  solar: (deps: GoogleProxyDeps, h: Record<string, string> = {}) => solarPost(post('/api/solar', { lat: 43.1, lng: -77.6 }, h), deps),
  route: (deps: GoogleProxyDeps, h: Record<string, string> = {}) =>
    routePost(post('/api/route', { waypoints: [{ lat: 43.1, lng: -77.6 }, { lat: 43.2, lng: -77.5 }], startAddress: 'S', endAddress: 'E' }, h), deps),
};

describe('mode', () => {
  it('defaults to log-only; only the exact word enforce enforces', () => {
    assert.equal(googleProxyMode({}), 'log-only');
    assert.equal(googleProxyMode({ GOOGLE_PROXY_AUTH: '' }), 'log-only');
    assert.equal(googleProxyMode({ GOOGLE_PROXY_AUTH: 'true' }), 'log-only');
    assert.equal(googleProxyMode({ GOOGLE_PROXY_AUTH: '1' }), 'log-only');
    assert.equal(googleProxyMode({ GOOGLE_PROXY_AUTH: 'enforce' }), 'enforce');
    assert.equal(googleProxyMode({ GOOGLE_PROXY_AUTH: ' ENFORCE ' }), 'enforce');
  });
});

describe('enforce mode', () => {
  for (const [name, run] of Object.entries(ALL)) {
    it(`${name}: 401 with no auth, and Google is never called`, async () => {
      const { deps, calls } = setup({ env: ENFORCE });
      const res = await run(deps);
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: 'unauthenticated' });
      assert.equal(calls.length, 0);
    });

    it(`${name}: 200 for a signed-in web user (Firebase bearer)`, async () => {
      const { deps, calls } = setup({ env: ENFORCE });
      const res = await run(deps, WEB);
      assert.equal(res.status, 200);
      assert.ok(calls.length >= 1);
    });

    it(`${name}: 200 for a native app Firebase bearer (with build headers)`, async () => {
      const { deps } = setup({ env: ENFORCE });
      assert.equal((await run(deps, MOBILE)).status, 200);
    });
  }

  it('an invalid or expired token is 401; a denied account is 403; a verify outage is 503', async () => {
    const { deps } = setup({ env: ENFORCE });
    assert.equal((await ALL.solar(deps, { authorization: 'Bearer nope' })).status, 401);
    assert.equal((await ALL.solar(deps, { authorization: 'Basic abc' })).status, 401);
    const denied = setup({ env: ENFORCE, user: { role: 'setter', isActive: false } });
    assert.equal((await ALL.solar(denied.deps, WEB)).status, 403);
    assert.equal(denied.calls.length, 0);
    const outage = setup({ env: ENFORCE, verifyThrows: new Error('network down') });
    assert.equal((await ALL.solar(outage.deps, WEB)).status, 503);
  });
});

describe('log-only mode (the default)', () => {
  it('unauthenticated calls still work exactly as installed builds expect', async () => {
    const { deps } = setup();
    for (const run of Object.values(ALL)) assert.equal((await run(deps)).status, 200);
  });

  it('logs route, build and platform of unauthenticated calls, never the key or an IP', async () => {
    const { deps } = setup();
    await ALL.geocodeForward(deps, { 'x-raydar-build': '164', 'x-raydar-platform': 'android', 'x-forwarded-for': '203.0.113.9' });
    const line = logs.find((l) => l.includes('[google-proxy] unauth'));
    assert.ok(line);
    assert.match(line, /route=geocode mode=log-only reason=no_token build=164 platform=android/);
    assert.ok(!logs.join('\n').includes('203.0.113.9'));
    assert.ok(!logs.join('\n').includes(KEY));
  });

  it('signed-in calls are not logged as unauthenticated', async () => {
    const { deps } = setup();
    await ALL.solar(deps, WEB);
    assert.equal(logs.some((l) => l.includes('[google-proxy] unauth')), false);
  });

  it('a bad token is treated as unauthenticated (still served, counted, rate limited), not rejected', async () => {
    const { deps } = setup();
    assert.equal((await ALL.solar(deps, { authorization: 'Bearer nope' })).status, 200);
    assert.ok(logs.some((l) => l.includes('reason=unauthenticated')));
  });

  it('the default unauthenticated limit is 600 per minute', () => assert.equal(DEFAULT_UNAUTH_LIMIT, 600));

  it('native callers (X-Raydar-Platform ios/android) are logged, never 429ed, however many share an IP (CGNAT)', async () => {
    const { deps } = setup();
    const ip = { 'x-forwarded-for': '100.64.1.1' };
    for (const platform of ['ios', 'android', 'IOS']) {
      for (let i = 0; i < DEFAULT_UNAUTH_LIMIT + 5; i += 1) {
        const res = await ALL.solar(deps, { ...ip, 'x-raydar-platform': platform, 'x-raydar-build': '164' });
        assert.equal(res.status, 200, `${platform} call ${i}`);
      }
    }
    assert.ok(logs.filter((l) => l.includes('platform=ios')).length >= DEFAULT_UNAUTH_LIMIT);
    // The same IP without the native header is still limited: the bucket was not used up by native calls.
    for (let i = 0; i < DEFAULT_UNAUTH_LIMIT; i += 1) assert.equal((await ALL.solar(deps, ip)).status, 200);
    assert.equal((await ALL.solar(deps, ip)).status, 429);
    assert.equal((await ALL.solar(deps, { ...ip, 'x-raydar-platform': 'web' })).status, 429, 'only ios/android are exempt');
  });

  it(`rate limits unauthenticated calls per IP and route (${DEFAULT_UNAUTH_LIMIT}/min), per instance`, async () => {
    let now = 5_000_000;
    const { deps } = setup({ now: () => now });
    const ip = { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' };
    for (let i = 0; i < DEFAULT_UNAUTH_LIMIT; i += 1) assert.equal((await ALL.geocodeForward(deps, ip)).status, 200, `call ${i}`);
    const limited = await ALL.geocodeForward(deps, ip);
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: 'rate_limited' });
    assert.equal((await ALL.geocodeForward(deps, { 'x-forwarded-for': '198.51.100.8' })).status, 200, 'another IP is unaffected');
    assert.equal((await ALL.solar(deps, ip)).status, 200, 'another route has its own bucket');
    assert.equal((await ALL.geocodeForward(deps, { ...ip, ...WEB })).status, 200, 'signed-in calls are not held to the unauthenticated limit');
    now += 61_000;
    assert.equal((await ALL.geocodeForward(deps, ip)).status, 200, 'window resets');
  });

  it('the limits are tunable by env', async () => {
    const { deps } = setup({ env: { GOOGLE_PROXY_UNAUTH_LIMIT_PER_MIN: '2' } });
    assert.equal((await ALL.solar(deps)).status, 200);
    assert.equal((await ALL.solar(deps)).status, 200);
    assert.equal((await ALL.solar(deps)).status, 429);
  });
});

describe('the Google key', () => {
  it('a body apiKey is ignored on /api/solar: the server key is used', async () => {
    const { deps, calls } = setup();
    const res = await solarPost(post('/api/solar', { lat: 43.1, lng: -77.6, apiKey: BODY_KEY }, WEB), deps);
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes(`key=${KEY}`));
    assert.ok(!calls[0].url.includes(BODY_KEY));
  });

  it('with no server key a body apiKey is not used as a fallback', async () => {
    const { deps, calls } = setup({ key: undefined });
    const res = await solarPost(post('/api/solar', { lat: 43.1, lng: -77.6, apiKey: BODY_KEY }, WEB), deps);
    assert.equal(res.status, 500);
    assert.equal(calls.length, 0);
    assert.ok(!(await res.text()).includes(BODY_KEY));
  });

  it('never appears in a response or a log, even when Google or fetch echoes it', async () => {
    const echo = async (url: string) => new Response(JSON.stringify({ error: { message: `API key not valid. key=${KEY}`, url } }), { status: 403, statusText: 'Forbidden' });
    for (const [name, run] of Object.entries(ALL)) {
      logs = [];
      const { deps } = setup({ google: echo });
      const res = await run(deps, WEB);
      const text = await res.text();
      assert.ok(!text.includes(KEY), `${name} response`);
      assert.ok(!text.includes(`${PREFIX}Sy`), `${name} response shape`);
      assert.ok(!logs.join('\n').includes(KEY), `${name} logs`);
    }
    const boom = setup({ google: async (url) => { throw new Error(`fetch failed for ${url}`); } });
    for (const [name, run] of Object.entries(ALL)) {
      logs = [];
      const res = await run(boom.deps, WEB);
      assert.equal(res.status, 500, name);
      assert.ok(!(await res.text()).includes(KEY), `${name} exception response`);
      assert.ok(!logs.join('\n').includes(KEY), `${name} exception logs`);
    }
  });

  it('a Google error status is passed through without the upstream body', async () => {
    const { deps } = setup({ google: async () => new Response('{"error":"details about the key"}', { status: 403, statusText: 'Forbidden' }) });
    const res = await ALL.geocodePost(deps, WEB);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'Forbidden' });
  });

  it('scrubKey removes the configured key and any key-shaped string', () => {
    assert.equal(scrubKey(`a ${KEY} b ${BODY_KEY}`, KEY), 'a <key> b <key>');
    assert.equal(scrubKey('nothing here', undefined), 'nothing here');
  });
});

describe('response shapes and validation (unchanged contract)', () => {
  it('forward and reverse GET, and POST, keep their shapes', async () => {
    const { deps, calls } = setup();
    const forward = await (await ALL.geocodeForward(deps, WEB)).json();
    assert.deepEqual(Object.keys(forward), ['results']);
    const reverse = await (await ALL.geocodeReverse(deps, WEB)).json();
    assert.deepEqual(Object.keys(reverse).sort(), ['formattedAddress', 'results']);
    assert.equal(reverse.formattedAddress, '1 Main St');
    const single = await (await ALL.geocodePost(deps, WEB)).json();
    assert.deepEqual(single, { lat: 43.1, lng: -77.6, formattedAddress: '1 Main St', types: ['street_address'] });
    assert.ok(calls[1].url.includes('latlng=43.1,-77.6'));
  });

  it('rejects junk lat/lng (no query-string injection), long addresses and oversized routes', async () => {
    const { deps, calls } = setup();
    assert.equal((await geocodeGet(req('/api/geocode?lat=1%26key%3Devil&lng=2'), deps)).status, 400);
    assert.equal((await geocodeGet(req('/api/geocode?lat=95&lng=2'), deps)).status, 400);
    assert.equal((await geocodePost(post('/api/geocode', { address: 'x'.repeat(MAX_ADDRESS_CHARS + 1) }), deps)).status, 400);
    assert.equal((await geocodePost(post('/api/geocode', { address: { a: 1 } }), deps)).status, 400);
    assert.equal((await solarPost(post('/api/solar', { lat: 'abc', lng: 1 }), deps)).status, 400);
    assert.equal((await solarPost(post('/api/solar', { lat: 43 }), deps)).status, 400);
    const many = Array.from({ length: MAX_ROUTE_STOPS + 1 }, (_, i) => ({ lat: 43 + i / 1e5, lng: -77 }));
    assert.equal((await routePost(post('/api/route', { waypoints: many }), deps)).status, 400);
    assert.equal((await routePost(post('/api/route', { waypoints: [{ lat: 'x', lng: 1 }] }), deps)).status, 400);
    assert.equal(calls.length, 0);
  });

  it('route: chunks of 25, reorders by waypointOrder, and falls back to the original order on a Google error', async () => {
    const stops = Array.from({ length: 60 }, (_, i) => ({ lat: 43 + i / 1e4, lng: -77 }));
    const ok = setup({ google: async () => Response.json({ routes: [{ waypointOrder: [0], legs: [{ endAddress: 'X', distanceMeters: 10, duration: '5s' }] }] }) });
    const first = await routePost(post('/api/route', { waypoints: stops.slice(0, 2), startAddress: 'S', endAddress: 'E' }, WEB), ok.deps);
    assert.equal(first.status, 200);
    const big = setup({ google: async () => new Response('nope', { status: 500 }) });
    const res = await routePost(post('/api/route', { waypoints: stops, startAddress: 'S', endAddress: 'E' }, WEB), big.deps);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.chunks, 3);
    assert.equal(body.stopCount, 60);
    assert.equal(big.calls.length, 3);
    assert.deepEqual(body.optimizedStops.map((s: { order: number }) => s.order).slice(0, 3), [1, 2, 3]);
  });
});

describe('web callers send the Firebase bearer', () => {
  it('no app code calls the Google proxy routes with a bare fetch', async () => {
    const { execFileSync } = await import('node:child_process');
    const { readFileSync } = await import('node:fs');
    const root = new URL('..', import.meta.url);
    const files = execFileSync('git', ['ls-files', 'app'], { cwd: root }).toString().split('\n').filter((f) => /\.(ts|tsx)$/.test(f));
    const bare: string[] = [];
    for (const file of files) {
      if (file === 'app/utils/authedFetch.ts') continue;
      const text = readFileSync(new URL(file, root), 'utf8');
      if (/(?<![A-Za-z])fetch\(\s*[`'"]\/api\/(geocode|solar|route)(?![-\w])/.test(text)) bare.push(file);
    }
    assert.deepEqual(bare, []);
  });
});

describe('real-world inputs are accepted', () => {
  it('a 74-char lead address, 300-char address, edge coordinates and a 1500-stop route all pass', async () => {
    const { deps } = setup();
    const longest = '1234 North Longstreet Boulevard Apartment 12B, Rochester, NY 14618'.padEnd(74, 'x');
    assert.equal((await geocodePost(post('/api/geocode', { address: longest }, WEB), deps)).status, 200);
    assert.equal((await geocodePost(post('/api/geocode', { address: 'x'.repeat(MAX_ADDRESS_CHARS) }, WEB), deps)).status, 200);
    assert.equal((await geocodeGet(req('/api/geocode?lat=-89.9999&lng=-179.9999', { headers: WEB }), deps)).status, 200);
    assert.equal((await solarPost(post('/api/solar', { lat: 90, lng: 180 }, WEB), deps)).status, 200);
  });

  it('route: MAX_ROUTE_STOPS stops are chunked by 25, run concurrently, and come back in order', async () => {
    const stops = Array.from({ length: MAX_ROUTE_STOPS }, (_, i) => ({ lat: 43 + i / 1e5, lng: -77 }));
    let active = 0;
    let peak = 0;
    const { deps, calls } = setup({
      google: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 2));
        active -= 1;
        const n = body.intermediates.length;
        assert.ok(n <= 25, 'Google allows at most 25 intermediates with optimization');
        return Response.json({ routes: [{ waypointOrder: Array.from({ length: n }, (_, i) => n - 1 - i), legs: Array.from({ length: n }, () => ({ endAddress: 'x', distanceMeters: 100, duration: '10s' })) }] });
      },
    });
    const res = await routePost(post('/api/route', { waypoints: stops, startAddress: 'S', endAddress: 'E' }, WEB), deps);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(calls.length, MAX_ROUTE_STOPS / 25);
    assert.equal(body.chunks, MAX_ROUTE_STOPS / 25);
    assert.equal(body.stopCount, MAX_ROUTE_STOPS);
    assert.ok(peak > 1 && peak <= 4, `peak concurrency ${peak}`);
    assert.deepEqual(body.optimizedStops.slice(0, 2).map((s: { lat: number }) => s.lat), [stops[24].lat, stops[23].lat], 'first chunk reversed by waypointOrder');
    assert.equal(body.optimizedStops[25].lat, stops[49].lat, 'second chunk follows the first');
    assert.ok(body.optimizedStops.every((s: { order: number }, i: number) => s.order === i + 1));
    assert.equal(body.distanceMeters, MAX_ROUTE_STOPS * 100);
  });
});

describe('CORS for webview callers', () => {
  const preflight = (origin: string, extra: Record<string, string> = {}) =>
    proxyPreflight(req('/api/geocode', {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type,x-raydar-build,x-raydar-platform', ...extra },
    }));

  it('allows capacitor://localhost, https://localhost and http://localhost with the auth and X-Raydar headers', () => {
    assert.deepEqual([...CORS_ALLOWED_ORIGINS].sort(), ['capacitor://localhost', 'http://localhost', 'https://localhost']);
    for (const origin of CORS_ALLOWED_ORIGINS) {
      const res = preflight(origin);
      assert.equal(res.status, 204);
      assert.equal(res.headers.get('access-control-allow-origin'), origin);
      const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase().split(',').map((h) => h.trim());
      for (const h of ['authorization', 'content-type', 'x-raydar-build', 'x-raydar-platform']) assert.ok(allowed.includes(h), h);
      assert.match(res.headers.get('access-control-allow-methods') ?? '', /POST/);
      assert.match(res.headers.get('access-control-allow-methods') ?? '', /GET/);
      assert.match(res.headers.get('vary') ?? '', /Origin/);
      assert.equal(res.headers.get('access-control-allow-credentials'), null);
    }
    assert.match(CORS_ALLOWED_HEADERS, /Authorization/);
  });

  it('answers 2xx with no auth, no Google call and no rate-limit use, in both modes', async () => {
    for (const env of [{}, ENFORCE]) {
      logs = [];
      const { deps, calls } = setup({ env });
      // The OPTIONS handler takes no deps at all: it cannot call Google, check a token or take a limiter slot.
      for (let i = 0; i < 5; i += 1) assert.equal(preflight('capacitor://localhost').status, 204);
      assert.equal(calls.length, 0);
      assert.equal(logs.some((l) => l.includes('[google-proxy]')), false);
      assert.equal((await ALL.solar(deps)).status, env === ENFORCE ? 401 : 200);
    }
  });

  it('other origins get a 2xx but no allow-origin (the browser blocks them)', () => {
    for (const origin of ['https://evil.example', 'https://localhost.evil.example', 'capacitor://localhost.evil.example', 'null']) {
      const res = preflight(origin);
      assert.equal(res.status, 204);
      assert.equal(res.headers.get('access-control-allow-origin'), null, origin);
    }
    assert.equal(proxyPreflight(req('/api/solar', { method: 'OPTIONS' })).status, 204, 'no Origin header');
  });

  it('real responses carry allow-origin for allowed origins, including 401 and 429, in both modes', async () => {
    const origin = { origin: 'capacitor://localhost' };
    for (const [mode, env] of [['log-only', {}], ['enforce', ENFORCE]] as const) {
      const { deps } = setup({ env });
      const handler = proxyRoute(solarPost, () => deps);
      const ok = await handler(post('/api/solar', { lat: 43.1, lng: -77.6 }, { ...origin, ...WEB }));
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get('access-control-allow-origin'), 'capacitor://localhost', mode);
      const bare = await handler(post('/api/solar', { lat: 43.1, lng: -77.6 }, origin));
      assert.equal(bare.status, mode === 'enforce' ? 401 : 200);
      assert.equal(bare.headers.get('access-control-allow-origin'), 'capacitor://localhost', `${mode} unauthenticated`);
      const other = await handler(post('/api/solar', { lat: 43.1, lng: -77.6 }, { origin: 'https://evil.example', ...WEB }));
      assert.equal(other.headers.get('access-control-allow-origin'), null);
    }
    const tiny = setup({ env: { GOOGLE_PROXY_UNAUTH_LIMIT_PER_MIN: '1' } });
    const limited = proxyRoute(solarPost, () => tiny.deps);
    await limited(post('/api/solar', { lat: 43, lng: -77 }, origin));
    const res = await limited(post('/api/solar', { lat: 43, lng: -77 }, origin));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('access-control-allow-origin'), 'capacitor://localhost');
  });

  it('every route file exports OPTIONS = proxyPreflight and no CORS config or middleware overrides it', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const root = new URL('..', import.meta.url);
    for (const route of ['geocode', 'solar', 'route']) {
      const text = readFileSync(new URL(`app/api/${route}/route.ts`, root), 'utf8');
      assert.match(text, /export const OPTIONS = proxyPreflight;/, route);
    }
    for (const f of ['middleware.ts', 'src/middleware.ts', 'proxy.ts']) {
      if (existsSync(new URL(f, root))) {
        assert.doesNotMatch(readFileSync(new URL(f, root), 'utf8'), /\/api\/(geocode|solar|route)|matcher/, `${f} must not intercept the Google proxy routes before their OPTIONS handler`);
      }
    }
    const config = readFileSync(new URL('next.config.ts', root), 'utf8');
    assert.doesNotMatch(config, /Access-Control/i, 'a global CORS header in next.config would conflict with the per-route handlers');
  });
});

describe('mobile line guard: authedFetch must ride the native transport', () => {
  it('when apiFetch exists (mobile line), authedFetch wraps it and never calls bare fetch', async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    const root = new URL('..', import.meta.url);
    const authed = readFileSync(new URL('app/utils/authedFetch.ts', root), 'utf8');
    if (!existsSync(new URL('app/utils/apiFetch.ts', root))) {
      // Web-only tree: there is no native transport, a plain fetch is correct.
      assert.match(authed, /return fetch\(/);
      return;
    }
    // The installed app is a Capacitor wrapper: relative '/api/...' only reaches the backend through
    // apiFetch (CapacitorHttp + NEXT_PUBLIC_API_BASE_URL). A bare fetch here would break installed builds.
    assert.match(authed, /import \{[^}]*\bapiFetch\b[^}]*\} from '@\/app\/utils\/apiFetch'/, 'authedFetch must import apiFetch');
    assert.match(authed, /apiFetch\(/);
    assert.doesNotMatch(authed.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''), /(?<![A-Za-z.])fetch\(/, 'authedFetch must not call bare fetch on the mobile line');
  });

  it('no call site reaches the Google proxy routes through apiFetch directly (it would skip the bearer)', async () => {
    const { execFileSync } = await import('node:child_process');
    const { readFileSync } = await import('node:fs');
    const root = new URL('..', import.meta.url);
    const files = execFileSync('git', ['ls-files', 'app'], { cwd: root }).toString().split('\n').filter((f) => /\.(ts|tsx)$/.test(f));
    const offenders = files.filter((file) => /\bapiFetch\(\s*[`'"]\/api\/(geocode|solar|route)(?![-\w])/.test(readFileSync(new URL(file, root), 'utf8')));
    assert.deepEqual(offenders, []);
  });
});
