# Raydar mobile v8 — field controls and territory tools

## Included

- Knock screen: removes Leaflet +/− controls (pinch zoom remains); compass occupies the upper left. The short **Areas** toggle replaces **List** in the toolbar. No duplicate team-area control on the map. Street/satellite imagery remains available.
- Removes **Next door**. **Focus** is centered 12px above the map bottom and shows unique doors knocked plus appointments set during the personal session. Uses the existing lead data and configured knock dispositions, including history; no new Firebase listeners, queries, writes, or polling.
- Today: managers/admins get **Manage territories** immediately below **Start knocking**. Other roles do not see it. Existing server authorization still controls access.
- Territory tools: **Rectangle** creates a four-corner rectangle by tapping two opposite corners. **Corners** supports custom boundaries with at least four corners. **Draw** supports tracing with a finger/mouse; **Move map** temporarily restores pan/zoom without losing the outline. Clear/undo and review still precede assignment.
- Town/state or ZIP search is above the territory map. Choose a result to move the map; no pins are reassigned by search. It uses the existing `/api/geocode` endpoint only on explicit Search, caches the last 30 queries in memory, and does not read Firestore. Uncached searches use the existing Google Geocoding quota/billing; no new provider/key is introduced.

## Install on the Mac mini

Download and unzip:
https://github.com/HappySolarCoder/happy-solar-leads/archive/refs/heads/codex/raydar-mobile-redesign-v8.zip

```bash
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v8" &&
cp "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v7/.env.local" .env.local &&
npm ci &&
npm run mobile:android
```

In Android Studio, select the connected Galaxy S25 and press Run. This compiles and installs v8; opening the folder alone does not update the phone.

The territory tools use the same backend from PR #151; no additional backend route/schema is needed for v8. PR #151 was merged October 10, 2026; the production route was verified to return the expected JSON 401 authentication response. This confirms route availability, not a signed-in assignment test. Verify the production route, if needed, with `npm run mobile:check-backend`.

## Validation

- Mobile logic tests, including custom/history knock counting, duplicate lead IDs, excluded ownership/history and rectangle validation.
- TypeScript and focused React lint checks.
- Native static export with synthetic configuration, including all 43 routes.
- Browser checks against the real Leaflet map: no zoom buttons/Next door/List; compass and Focus placement at 393×852, 360×640 and 852×393; one Areas toggle; both Focus counters; online/cached pin selection remains read-only.
- Territory browser checks: town/ZIP results and no-results, rectangle, custom corners, freehand drawing, review, create/rename/transfer/remove boundary and imagery toggle, all using fictional data. Live search component verified with a mocked API for explicit submit, cached repeat, result bounds and failure feedback.
- Today shortcut role visibility and navigation through the production Today component with mocked authentication.

Android APK compilation and physical Galaxy sensor testing require the Mac's Android SDK and device. No production leads were changed during these checks.
