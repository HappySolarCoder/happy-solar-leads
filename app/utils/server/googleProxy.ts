import { NextResponse } from 'next/server';
import { HttpError, requireApprovedUser, type RequireApprovedUserDeps } from './requireApprovedUser';
import { MAX_ADDRESS_CHARS, MAX_ROUTE_STOPS } from '../googleProxyLimits';

/**
 * Auth, rate limits and Google calls for /api/geocode, /api/route and /api/solar.
 *
 * Callers: the web app and the Raydar native app (same web bundle, see apiFetch). They may send
 * `Authorization: Bearer <Firebase ID token>`, which is how every other Raydar API authenticates
 * (web pages and mobile both use getIdToken). Installed native builds 14.11..14.23 call these
 * routes WITHOUT a token, so enforcement is a mode:
 *
 *   GOOGLE_PROXY_AUTH unset / 'log-only' (default): unauthenticated calls still work. They are
 *       counted in the logs (route, build, platform; never IP or key) and rate limited per IP.
 *   GOOGLE_PROXY_AUTH = 'enforce': no valid, approved Firebase bearer = 401. Flip only after
 *       the native builds that call these routes send a token (see docs/google-proxy-hardening.md).
 *
 * The Google key is never accepted from a caller, never put in a response and scrubbed from logs.
 */
export type GoogleProxyMode = 'log-only' | 'enforce';
export type GoogleRoute = 'geocode' | 'route' | 'solar';

export const GOOGLE_PROXY_MODE_ENV = 'GOOGLE_PROXY_AUTH';
export const UNAUTH_LIMIT_ENV = 'GOOGLE_PROXY_UNAUTH_LIMIT_PER_MIN';
export const AUTH_LIMIT_ENV = 'GOOGLE_PROXY_AUTH_LIMIT_PER_MIN';
/**
 * Unauthenticated calls per client IP, per route, per instance, per minute. Carrier CGNAT puts many
 * phones behind one IP, so native callers (X-Raydar-Platform ios/android) are never limited by IP in
 * log-only mode; they are only logged. The limit applies to web/unknown callers.
 */
export const DEFAULT_UNAUTH_LIMIT = 600;
/** Signed-in calls per user, per route, per instance, per minute. High on purpose: CSV upload geocodes in parallel batches. */
export const DEFAULT_AUTH_LIMIT = 5000;
const WINDOW_MS = 60_000;
const NATIVE_PLATFORMS = new Set(['ios', 'android']);
const MAX_TRACKED = 5000;

type Env = Record<string, string | undefined>;

export const ENFORCE_ROUTES_ENV = 'GOOGLE_PROXY_ENFORCE_ROUTES';

export function googleProxyMode(env: Env = process.env): GoogleProxyMode {
  return (env[GOOGLE_PROXY_MODE_ENV] ?? '').trim().toLowerCase() === 'enforce' ? 'enforce' : 'log-only';
}

/**
 * Mode for one route. With GOOGLE_PROXY_AUTH=enforce every route enforces, unless
 * GOOGLE_PROXY_ENFORCE_ROUTES lists some (e.g. "geocode,route"): then only those enforce and the rest
 * stay log-only. This lets geocode/route be enforced while /api/solar (not covered by native build 168) is not.
 */
export function routeMode(route: GoogleRoute, env: Env = process.env): GoogleProxyMode {
  if (googleProxyMode(env) !== 'enforce') return 'log-only';
  const listed = (env[ENFORCE_ROUTES_ENV] ?? '').split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
  return listed.length === 0 || listed.includes(route) ? 'enforce' : 'log-only';
}

function limitFrom(env: Env, name: string, fallback: number): number {
  const n = Number(env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export class MinuteLimiter {
  private hits = new Map<string, { start: number; count: number }>();
  /** True when this call is within `limit` for the current minute window. */
  take(key: string, limit: number, now: number): boolean {
    const hit = this.hits.get(key);
    if (!hit || now - hit.start >= WINDOW_MS || now < hit.start) {
      if (this.hits.size >= MAX_TRACKED) {
        for (const [k, v] of this.hits) if (now - v.start >= WINDOW_MS) this.hits.delete(k);
        if (this.hits.size >= MAX_TRACKED) this.hits.clear();
      }
      this.hits.set(key, { start: now, count: 1 });
      return true;
    }
    hit.count += 1;
    return hit.count <= limit;
  }
}

const sharedLimiter = new MinuteLimiter();

export type GoogleProxyDeps = RequireApprovedUserDeps & {
  fetch: typeof fetch;
  /** The server key. Never read from the request. */
  apiKey: () => string | undefined;
  env?: Env;
  now?: () => number;
  limiter?: MinuteLimiter;
};

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const KEY_PATTERN = /AIza[0-9A-Za-z_-]{35}/g;

/** Removes the configured key (and anything shaped like a Google key) from text. */
export function scrubKey(text: string, key: string | undefined): string {
  let out = text;
  if (key) out = out.split(key).join('<key>');
  return out.replace(KEY_PATTERN, '<key>');
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Returns a Response to send (401/403/429/503) or null to continue.
 * Log-only: never rejects for auth, only rate limits the unauthenticated.
 */
export async function guardGoogleProxy(
  request: Request,
  route: GoogleRoute,
  deps: GoogleProxyDeps,
): Promise<Response | null> {
  const env = deps.env ?? process.env;
  const mode = routeMode(route, env);
  const now = deps.now?.() ?? Date.now();
  const limiter = deps.limiter ?? sharedLimiter;
  const authorization = request.headers.get('authorization');

  let uid: string | null = null;
  let failure: { status: number; error: string } | null = null;
  if (authorization) {
    try {
      uid = (await requireApprovedUser(authorization, deps)).uid;
    } catch (error) {
      failure = error instanceof HttpError
        ? { status: error.status === 401 ? 401 : 403, error: error.status === 401 ? 'unauthenticated' : 'forbidden' }
        : { status: 503, error: 'auth_unavailable' };
    }
  } else {
    failure = { status: 401, error: 'unauthenticated' };
  }

  if (uid) {
    if (!limiter.take(`u|${route}|${uid}`, limitFrom(env, AUTH_LIMIT_ENV, DEFAULT_AUTH_LIMIT), now)) {
      return json({ error: 'rate_limited' }, 429);
    }
    return null;
  }

  // Not authenticated. Count it so the builds still calling bare can be found before enforcing.
  const build = (request.headers.get('x-raydar-build') ?? '-').slice(0, 12);
  const platform = (request.headers.get('x-raydar-platform') ?? 'web-or-unknown').slice(0, 12);
  console.log(`[google-proxy] unauth route=${route} mode=${mode} reason=${authorization ? failure?.error : 'no_token'} build=${build} platform=${platform}`);
  if (mode === 'enforce') {
    return json({ error: failure?.error ?? 'unauthenticated' }, failure?.status ?? 401);
  }
  if (NATIVE_PLATFORMS.has(platform.toLowerCase())) return null;
  if (!limiter.take(`i|${route}|${clientIp(request)}`, limitFrom(env, UNAUTH_LIMIT_ENV, DEFAULT_UNAUTH_LIMIT), now)) {
    return json({ error: 'rate_limited' }, 429);
  }
  return null;
}

function requireKey(deps: GoogleProxyDeps): string | Response {
  const key = deps.apiKey();
  return key && key.trim() ? key.trim() : json({ error: 'Missing API key in environment' }, 500);
}

function finite(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function validPoint(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = finite(lat);
  const b = finite(lng);
  if (a == null || b == null || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lng: b };
}

function validAddress(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && value.length <= MAX_ADDRESS_CHARS ? value : null;
}

async function googleError(response: Response, label: string, key: string): Promise<Response> {
  const text = scrubKey(await response.text().catch(() => ''), key);
  console.error(`[${label}] Google error ${response.status}:`, text.slice(0, 300));
  // The upstream body is logged (scrubbed) but not returned: it can describe the key.
  return json({ error: response.statusText || 'Upstream error' }, response.status);
}

function safeMessage(error: unknown, key: string | undefined): string {
  return scrubKey(error instanceof Error ? error.message : 'Internal error', key).slice(0, 200);
}

// ---------------------------------------------------------------- geocode

export async function geocodeGet(request: Request, deps: GoogleProxyDeps): Promise<Response> {
  const denied = await guardGoogleProxy(request, 'geocode', deps);
  if (denied) return denied;
  const key = requireKey(deps);
  if (typeof key !== 'string') return key;
  try {
    const { searchParams } = new URL(request.url);
    const addressParam = searchParams.get('address');
    if (addressParam) {
      const address = validAddress(addressParam);
      if (!address) return json({ error: 'Invalid address' }, 400);
      const response = await deps.fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`);
      if (!response.ok) return googleError(response, 'Geocode API', key);
      const data = await response.json();
      if (data.status !== 'OK') return json({ error: `Geocoding failed: ${String(data.status).slice(0, 40)}` }, 400);
      return NextResponse.json({ results: data.results });
    }
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');
    if (!lat || !lng) return json({ error: 'Missing lat/lng or address' }, 400);
    const point = validPoint(lat, lng);
    if (!point) return json({ error: 'Invalid lat/lng' }, 400);
    const response = await deps.fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${point.lat},${point.lng}&key=${key}`);
    if (!response.ok) return googleError(response, 'Reverse Geocode API', key);
    const data = await response.json();
    if (data.status !== 'OK') return json({ error: `Reverse geocoding failed: ${String(data.status).slice(0, 40)}` }, 400);
    return NextResponse.json({ results: data.results, formattedAddress: data.results[0]?.formatted_address });
  } catch (error) {
    console.error('[Geocode API] Exception:', safeMessage(error, key));
    return json({ error: safeMessage(error, key) }, 500);
  }
}

export async function geocodePost(request: Request, deps: GoogleProxyDeps): Promise<Response> {
  const denied = await guardGoogleProxy(request, 'geocode', deps);
  if (denied) return denied;
  let key: string | undefined;
  try {
    const body = await request.json();
    if (!body?.address) return json({ error: 'Missing address' }, 400);
    const address = validAddress(body.address);
    if (!address) return json({ error: 'Invalid address' }, 400);
    const resolved = requireKey(deps);
    if (typeof resolved !== 'string') return resolved;
    key = resolved;
    const response = await deps.fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`);
    if (!response.ok) return googleError(response, 'Geocode API', key);
    const data = await response.json();
    if (data.status !== 'OK') return json({ error: `Geocoding failed: ${String(data.status).slice(0, 40)}` }, 400);
    const result = data.results[0];
    return NextResponse.json({
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formattedAddress: result.formatted_address,
      types: result.types || [],
    });
  } catch (error) {
    console.error('[Geocode API] Exception:', safeMessage(error, key));
    return json({ error: safeMessage(error, key) }, 500);
  }
}

// ---------------------------------------------------------------- solar

/** `apiKey` in the body is ignored on purpose: the key only ever comes from the server environment. */
export async function solarPost(request: Request, deps: GoogleProxyDeps): Promise<Response> {
  const denied = await guardGoogleProxy(request, 'solar', deps);
  if (denied) return denied;
  let key: string | undefined;
  try {
    const body = await request.json();
    if (!body?.lat || !body?.lng) return json({ error: 'Missing lat or lng' }, 400);
    const point = validPoint(body.lat, body.lng);
    if (!point) return json({ error: 'Invalid lat/lng' }, 400);
    const resolved = requireKey(deps);
    if (typeof resolved !== 'string') return resolved;
    key = resolved;
    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${point.lat}&location.longitude=${point.lng}&requiredQuality=HIGH&key=${key}`;
    const response = await deps.fetch(url, { headers: { Accept: 'application/json' } });
    console.log('[Solar] Response status:', response.status);
    if (!response.ok) return googleError(response, 'Solar', key);
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[Solar] Exception:', safeMessage(error, key));
    return json({ error: safeMessage(error, key) }, 500);
  }
}

// ---------------------------------------------------------------- route

const MAX_WAYPOINTS = 25;
const ROUTE_CHUNK_CONCURRENCY = 4;

type Waypoint = { lat: number; lng: number; address?: string };

export async function routePost(request: Request, deps: GoogleProxyDeps): Promise<Response> {
  const denied = await guardGoogleProxy(request, 'route', deps);
  if (denied) return denied;
  let key: string | undefined;
  try {
    const { waypoints, startAddress, endAddress } = await request.json();
    if (!Array.isArray(waypoints) || waypoints.length < 1) return json({ error: 'Need at least 1 waypoint' }, 400);
    if (waypoints.length > MAX_ROUTE_STOPS) return json({ error: `At most ${MAX_ROUTE_STOPS} stops per route` }, 400);
    const stops: Waypoint[] = [];
    for (const w of waypoints) {
      const point = validPoint(w?.lat, w?.lng);
      if (!point) return json({ error: 'Invalid waypoint' }, 400);
      stops.push({ ...point, ...(typeof w.address === 'string' ? { address: w.address.slice(0, MAX_ADDRESS_CHARS) } : {}) });
    }
    for (const a of [startAddress, endAddress]) {
      if (a != null && (typeof a !== 'string' || a.length > MAX_ADDRESS_CHARS)) return json({ error: 'Invalid address' }, 400);
    }
    const resolved = requireKey(deps);
    if (typeof resolved !== 'string') return resolved;
    key = resolved;

    const chunks: Waypoint[][] = [];
    for (let i = 0; i < stops.length; i += MAX_WAYPOINTS) chunks.push(stops.slice(i, i + MAX_WAYPOINTS));

    // Chunks do not depend on each other (origin/destination come from the request), so a few run
    // at a time to keep large lists inside the function time limit. Results are assembled in order.
    type ChunkResult = { ordered: Waypoint[]; legs: Array<Record<string, unknown> | undefined> } | null;
    const results: ChunkResult[] = new Array(chunks.length).fill(null);
    const runChunk = async (c: number) => {
      const chunk = chunks[c];
      const origin = c === 0 ? startAddress : chunk[0].address || startAddress;
      const destination = c === chunks.length - 1 ? endAddress : chunk[chunk.length - 1].address || endAddress;
      const response = await deps.fetch(`https://routes.googleapis.com/directions/v2:computeRoutes?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': '*' },
        body: JSON.stringify({
          origin: { address: origin },
          destination: { address: destination },
          intermediates: chunk.map((w) => ({ location: { latLng: { latitude: Number(w.lat.toFixed(7)), longitude: Number(w.lng.toFixed(7)) } } })),
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
          optimizeWaypointOrder: true,
        }),
      });
      if (!response.ok) {
        console.log(`[Route API] Chunk ${c + 1} error:`, scrubKey(await response.text().catch(() => ''), key).slice(0, 300));
        return;
      }
      const data = await response.json();
      const route = data.routes?.[0];
      if (route && route.waypointOrder) {
        results[c] = { ordered: (route.waypointOrder as number[]).map((index) => chunk[index]), legs: route.legs ?? [] };
      }
    };
    let next = 0;
    const workers = Array.from({ length: Math.min(ROUTE_CHUNK_CONCURRENCY, chunks.length) }, async () => {
      while (next < chunks.length) {
        const c = next;
        next += 1;
        await runChunk(c);
      }
    });
    await Promise.all(workers);

    const optimized: Array<Record<string, unknown>> = [];
    let totalDistance = 0;
    let totalDuration = 0;
    let order = 0;
    for (let c = 0; c < chunks.length; c += 1) {
      const result = results[c];
      if (!result) {
        for (const wp of chunks[c]) {
          order += 1;
          optimized.push({ order, lat: wp.lat, lng: wp.lng, address: wp.address || `Stop ${order}`, distanceMeters: 0, duration: '0s' });
        }
        continue;
      }
      result.ordered.forEach((wp, index) => {
        const leg = result.legs[index] as { endAddress?: string; distanceMeters?: number; duration?: string } | undefined;
        order += 1;
        optimized.push({
          order,
          lat: wp.lat,
          lng: wp.lng,
          address: leg?.endAddress || `Stop ${order}`,
          distanceMeters: leg?.distanceMeters || 0,
          duration: leg?.duration || '0s',
        });
        if (leg?.distanceMeters) totalDistance += leg.distanceMeters;
        if (leg?.duration) totalDuration += parseInt(String(leg.duration).replace('s', ''), 10) || 0;
      });
    }

    return NextResponse.json({
      distanceMeters: totalDistance,
      durationSeconds: totalDuration,
      distanceMiles: Math.round(totalDistance * 0.000621371 * 10) / 10,
      durationMinutes: Math.round(totalDuration / 60),
      stopCount: optimized.length,
      optimizedStops: optimized,
      chunks: chunks.length,
    });
  } catch (error) {
    console.error('[Route API] Exception:', safeMessage(error, key));
    return json({ error: safeMessage(error, key) }, 500);
  }
}
