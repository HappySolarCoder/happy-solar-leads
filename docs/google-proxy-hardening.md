# Google proxy routes: auth and enforcement

Routes: `/api/geocode` (Geocoding), `/api/solar` (Solar buildingInsights), `/api/route` (Routes computeRoutes).
Code: `app/utils/server/googleProxy.ts`. Live wiring: `googleProxyLive.ts`. The key is `GOOGLE_API_KEY`, server only.

## What a caller may send
`Authorization: Bearer <Firebase ID token>` (same as every other Raydar API). The web app adds it with
`authedFetch`. The native app's `apiFetch` does not add one today.

## Modes (env `GOOGLE_PROXY_AUTH`)
- unset or anything but `enforce` = **log-only** (default). Unauthenticated calls work. They are counted:
  `[google-proxy] unauth route=… mode=… reason=… build=… platform=…` (no IP, no key) and limited to
  600 per IP per route per minute per instance (`GOOGLE_PROXY_UNAUTH_LIMIT_PER_MIN`). Callers sending `X-Raydar-Platform: ios|android` are logged, never limited by IP (carrier CGNAT puts many phones behind one IP). The header is spoofable, so in log-only mode the limit is a web-abuse backstop, not a guarantee.
- `enforce`: no valid, approved bearer = 401 (invalid token 401, denied account 403, token check outage 503).
  Signed-in users are limited to 5000 per route per minute per instance (`GOOGLE_PROXY_AUTH_LIMIT_PER_MIN`).

Rate limits are per serverless instance, so they cap abuse, not exact usage.

## Before flipping to enforce
1. Web: this PR deployed (every web caller sends the bearer).
2. Native: every installed build must send the bearer on `/api/geocode` (mobile knocking search,
   territory PlaceSearch, reverse geocode on pin drop) and `/api/route` (RouteBuilder). Builds 14.11
   (151) through 14.23 (167) call without a token. 14.18+ send `X-Raydar-Build`, so the log line shows which
   build numbers are still unauthenticated. 14.11 and 14.12 send no build header.
3. Watch the log for a week: no `unauth` lines from real builds, then set `GOOGLE_PROXY_AUTH=enforce`
   (env change + redeploy). Rolling back is unsetting it.
4. Rotate the exposed key and restrict the new one (Geocoding, Routes, Solar APIs).

## Limits (checked against real data)
- Address: 300 chars. Real lead queries ("street, city, ST zip") are at most 74 chars in a 2000-lead sample; coordinates are all numeric and in range.
- `/api/route`: 1500 stops, chunked server-side into 25-intermediate Routes API calls (Google's limit with
  waypoint optimization), four at a time, `maxDuration = 60`. `RouteBuilder` sends at most 1500 and tells the user when it truncates.
  (RouteBuilder is not mounted anywhere today.)

## CORS
Native builds use CapacitorHttp (no preflight). If a build uses the webview's `fetch`, `Authorization` and the
`X-Raydar-*` headers force a preflight. Each route exports `OPTIONS = proxyPreflight`: 204 with no auth in both modes,
allowing origins `capacitor://localhost`, `https://localhost`, `http://localhost`; headers `Authorization, Content-Type,
X-Raydar-Build, X-Raydar-Platform`; methods `GET, POST, OPTIONS`. Real responses (including 401/429) carry
`Access-Control-Allow-Origin` for those origins. No credentials are allowed.

## Merging with the mobile line
On the mobile line `authedFetch` must call `apiFetch` (CapacitorHttp + `NEXT_PUBLIC_API_BASE_URL`), not bare
`fetch`, or installed builds cannot reach the backend. `tests/google-proxy.test.ts` fails when `app/utils/apiFetch.ts`
exists and `authedFetch` does not wrap it.
