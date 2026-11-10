# Google proxy routes: auth and enforcement

Routes: `/api/geocode` (Geocoding), `/api/solar` (Solar buildingInsights), `/api/route` (Routes computeRoutes).
Code: `app/utils/server/googleProxy.ts`. Live wiring: `googleProxyLive.ts`. The key is `GOOGLE_API_KEY`, server only.

## What a caller may send
`Authorization: Bearer <Firebase ID token>` (same as every other Raydar API). The web app adds it with
`authedFetch`. The native app's `apiFetch` does not add one today.

## Modes (env `GOOGLE_PROXY_AUTH`)
- unset or anything but `enforce` = **log-only** (default). Unauthenticated calls work. They are counted:
  `[google-proxy] unauth route=… mode=… reason=… build=… platform=…` (no IP, no key) and limited to
  120 per IP per route per minute per instance (`GOOGLE_PROXY_UNAUTH_LIMIT_PER_MIN`).
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
