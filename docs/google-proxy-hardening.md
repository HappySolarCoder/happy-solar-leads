# Google proxy routes: auth and enforcement

Routes: `/api/geocode` (Geocoding), `/api/solar` (Solar buildingInsights), `/api/route` (Routes computeRoutes).
Code: `app/utils/server/googleProxy.ts`. Live wiring: `googleProxyLive.ts`. The key is `GOOGLE_API_KEY`, server only.

## What a caller may send
`Authorization: Bearer <Firebase ID token>` (same as every other Raydar API). The web app adds it with
`authedFetch`. The native app's `apiFetch` in 14.23/167 and earlier sends **no** token. 14.24/168 is the first build
whose `nativeApiFetch` adds the bearer, for `/api/geocode` and `/api/route`.

## Modes (env `GOOGLE_PROXY_AUTH`)
- unset or anything but `enforce` = **log-only** (default). Unauthenticated calls work. They are counted:
  `[google-proxy] unauth route=… mode=… reason=… build=… platform=…` (no IP, no key) and limited to
  600 per IP per route per minute per instance (`GOOGLE_PROXY_UNAUTH_LIMIT_PER_MIN`). Callers sending `X-Raydar-Platform: ios|android` are logged, never limited by IP (carrier CGNAT puts many phones behind one IP). The header is spoofable, so in log-only mode the limit is a web-abuse backstop, not a guarantee.
- `enforce`: no valid, approved bearer = 401 (invalid token 401, denied account 403, token check outage 503).
  Signed-in users are limited per route per minute per instance: **5000** for geocode and solar, **60 for `/api/route`**
  (`GOOGLE_PROXY_AUTH_LIMIT_PER_MIN`, if set, overrides all three). `/api/route` is low because one request can be up
  to 60 Routes API calls: 1500 stops is close to the 60 s `maxDuration`, so revisit both numbers if `RouteBuilder` is ever mounted.
- `GOOGLE_PROXY_ENFORCE_ROUTES` names that are not `geocode`, `route` or `solar` are ignored with a one-time
  `[google-proxy] … unknown route "…"` warning in the logs. A route that is not listed stays log-only, so a typo
  leaves that route unenforced: check the logs after changing it.

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
`fetch`, so no CORS headers or OPTIONS handlers are added or needed. This tree carries a **web-only stub** of
`app/utils/apiFetch.ts`. When the mobile line is merged:

- Take the **14.24/168+** `app/utils/apiFetch.ts` (add/add conflict): the one whose `nativeApiFetch` adds the
  `Authorization: Bearer <Firebase ID token>` for `/api/geocode` and `/api/route`. **Today's 167 `apiFetch` sends no
  token**, so merging 167 as it is would leave native calls unauthenticated.
- Keep the call sites on `apiFetch` (knocking `page.tsx`, `PlaceSearch.tsx`, `LeadMap.tsx` reverse geocode,
  `RouteBuilder.tsx`, `utils/geocode.ts`, `app/page.tsx`).
- `authedFetch` always goes through `apiFetch` and never overwrites an `Authorization` header the caller supplied.

`tests/google-proxy.test.ts` guards this: it fails if any call site uses a bare `fetch`, if `authedFetch` stops
delegating to `apiFetch`, if the stub survives next to CapacitorHttp code, or if a native (non-stub) `apiFetch.ts`
has no bearer logic (`getIdToken`, `Authorization`, geocode and route). The bearer check skips on main, where
only the stub exists.
