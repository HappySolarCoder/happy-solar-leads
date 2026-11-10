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

## Builds
- **14.24 / build 168 is the first native build that sends the bearer** (from `apiFetch`). 14.11 through 14.23
  (151 to 167) do not.
- `/api/solar` native coverage is **out of scope for 168**. Its callers (LeadMap background solar, UploadModal,
  test-solar) keep sending no bearer from native until a later build. So enforce `geocode` and `route` only:
  set `GOOGLE_PROXY_ENFORCE_ROUTES=geocode,route` together with `GOOGLE_PROXY_AUTH=enforce`; `/api/solar` stays
  log-only (still rate limited, still logged). Without that variable, enforce applies to all three routes.

## Before flipping to enforce
1. Web: this PR deployed (every web caller sends the bearer).
2. Native: enforce waits until **168 is the minimum field build** (older builds retired or force-updated) and the
   `[google-proxy] unauth … build=` logs show no older builds. 14.11 (151) and 14.12 (152) send no build header, so
   they log as `build=-`. A `build=-` line from a native user means one of those is still in the field.
3. Watch the log for a week, then set `GOOGLE_PROXY_AUTH=enforce` and `GOOGLE_PROXY_ENFORCE_ROUTES=geocode,route` (env change + redeploy). Rolling back is unsetting it.
4. Rotate the exposed key and restrict the new one (Geocoding, Routes, Solar APIs).

## Limits (checked against real data)
- Address: 300 chars. Real lead queries ("street, city, ST zip") are at most 74 chars in a 2000-lead sample; coordinates are all numeric and in range.
- `/api/route`: 1500 stops, chunked server-side into 25-intermediate Routes API calls (Google's limit with
  waypoint optimization), four at a time, `maxDuration = 60`. `RouteBuilder` sends at most 1500 and tells the user when it truncates.
  (RouteBuilder is not mounted anywhere today.)

## Merging with the mobile line
The native app sends `/api/*` through `apiFetch` (CapacitorHttp to `NEXT_PUBLIC_API_BASE_URL`), never the webview's
`fetch`, so no CORS headers or OPTIONS handlers are added or needed. `authedFetch` always goes through `apiFetch`
and never overwrites an `Authorization` header the caller supplied. This tree carries a **web-only stub** of
`app/utils/apiFetch.ts`; when the mobile line is merged, take the mobile version of that file (add/add conflict).
The six mobile call sites (knocking `page.tsx`, `PlaceSearch.tsx`, `LeadMap.tsx` reverse geocode, `RouteBuilder.tsx`,
`utils/geocode.ts`, `app/page.tsx`) stay `apiFetch`. `tests/google-proxy.test.ts` fails if any call site uses a bare
`fetch`, if `authedFetch` stops delegating to `apiFetch`, or if the stub survives next to CapacitorHttp code.
