# Raydar Next v6 — Warm lead identification, roof view and compass

## Pins

Solar-rated uploaded prospects carry an inline Signal R badge. Identification uses the existing solar-data tag, or legacy solar score/category when the lead is not explicitly manual. A tagged solar-data upgrade retains the mark. Customer and historical territory pins do not acquire the warm-lead label. Assignment does not change the badge. Status glyphs, roof-quality accents, GHL outcome badges and selection brackets remain independent.

Pins are 36px wide at zoom 16–17 and 30px at zoom 18+, compared with 44px previously. The transparent hit area remains at least 44px. The tip remains anchored to the actual coordinate. Marker cache tiers include the roof-zoom boundary so zooming in and out updates existing markers. No external logo requests are made per pin.

## Compass

Tap the compact North / Compass control below the zoom buttons, then Turn on compass. Android uses a local Capacitor plugin with the device rotation-vector magnetic sensor. It never substitutes GPS travel bearing or relative gyro yaw for a compass. Browser/iOS support uses absolute orientation or WebKit compass readings when available, with user-triggered permission requests. Unsupported/denied, calibration, tilt and stale readings have explicit fallback messages. The map always remains north-up.

Hold the phone flat, screen up; the reading follows the top edge of the currently oriented screen. Android readings refer to magnetic north. Map imagery is true-north-up, so small differences are expected. The panel explains how to estimate a home's front-facing direction and how to read roof slopes on satellite imagery. No automatic house or roof orientation is inferred.

Sensor events are throttled to 10Hz, smoothed across north, and confined to the compass component. Sensor subscriptions stop when disabled, hidden, unmounted or backgrounded. No Firestore schema changes, queries, writes, extra GPS watch, paid service, or network polling were added.

## Validation

Run `npm run mobile:test` for pin classification, cardinal/landscape orientation, north-crossing smoothing and existing mobile regressions. `scripts/mobile/check-compass-v6.mjs` checks the built fictional preview with simulated sensor events and external requests blocked. Browser simulation cannot verify a phone's physical magnetic sensor. Android compilation and physical calibration must be checked in Android Studio/on the Galaxy S25; this build environment has no Android SDK or Java 21.

Native implementation references: https://capacitorjs.com/docs/android/custom-code and https://developer.android.com/reference/android/hardware/SensorManager . Browser coordinate reference: https://www.w3.org/TR/orientation-event/ .

## Territory manager

Open **More → Manage territories** (`/mobile/territories`). Native links to the old `/lead-management`, `/territories`, and `/admin/assignments` pages redirect here. Existing website navigation stays unchanged.

- Real Leaflet satellite/street map, touch-friendly corner drawing, undo and pan/zoom.
- Name an area, choose a rep, explicitly preview available pins, then confirm.
- Search and rep filter; select a saved area to fit the map; rename, transfer or remove its boundary.
- Managers are restricted to the same nonempty `users.team` as their own profile (plus themselves). Admins can manage all teams. Missing team means no access to other reps. Only active, approved recipients are selectable.
- Creates reject overlap with existing boundaries and crossing/invalid polygons. Existing self-crossing legacy polygons cannot be transferred; boundary removal still works.
- Transfers move only still-unworked pins assigned to the old area owner. Claims, manual prospects, customers, outcomes, disposition history and worked pins remain with their current owners. Counts in the list are **at last save**, not live activity counts.
- Removing a boundary copies it to `archived_territories` and deletes the active boundary atomically. It never deletes or unassigns a lead. The archive collection remains default-denied to browser clients.
- Save transactions are atomic, version checked and retry-safe for the last operation. Concurrent stale edits fail with a review/refresh message. Lead versions are rechecked after preview. There are no background assignment jobs.

### Backend prerequisite — required before territory management works

The installed app is static. Its new authenticated `/api/territory-management` endpoint must run on the HTTPS backend in `NEXT_PUBLIC_API_BASE_URL`. Merely installing v6 does not deploy that endpoint. Until it is deployed, the app explains that the backend update is missing instead of silently showing an empty territory list.

Backend-only draft PR: https://github.com/HappySolarCoder/happy-solar-leads/pull/151 . It has not been merged or deployed.

Deploy these three new files on the current backend, using its existing `FIREBASE_SERVICE_ACCOUNT` server environment:

- `app/api/territory-management/route.ts`
- `app/utils/server/territoryManagement.ts`
- `app/utils/territoryManager.ts`

No Firebase rule changes, new indexes, paid map subscription, dependency changes, secrets in the mobile bundle, or changes to existing website screens are required for that backend-only update. The broader mobile redesign branch should not be deployed to the existing website without reviewing its other changes.

### Firebase usage and practical limits

No lead reads occur when panning, zooming, filtering the local list, or using the compass. One explicit preview reads at most 1,001 lead documents using the existing latitude index; longitude and polygon filtering happen server-side. It refuses incomplete results and areas above 400 eligible pins. A save reads reviewed documents again and writes the assignments plus one boundary atomically. Creates also check up to 501 existing boundaries for overlap; list refresh loads the roster and up to 501 boundaries. Workspaces above 500 active areas need a pagination extension before using this editor. Larger legacy territories cannot be transferred here; they can be renamed or have only their boundary removed.

These operations incur normal Firebase reads/writes. There is no guarantee of an unchanged bill; the design avoids background polling, per-pan queries and whole-lead-collection downloads. Latitude-only indexing may require a smaller north/south span in dense regions, even when a boundary looks narrow east/west. Adding a geospatial index would be a separate migration.

### Verification

- `npm run mobile:test`: 34 passing tests, including real API handlers against an in-memory Firestore adapter (authorization, rollback, retry, stale preview, overlap, transfer and boundary removal).
- Full repository `tsc --noEmit`: passed. Focused ESLint: passed.
- Native static export: 43 routes compiled and type checked.
- `scripts/mobile/check-territories-v6.mjs`: exercises the shared manager UI with memory-only fixtures and touch input. Create, undo, rename, transfer, remove, search, rep filter and imagery toggle. No live API calls. Screenshots use conspicuously labeled DEMO MAP tiles, not actual satellite photography.
- No live company assignments were changed. A backend deployment and an authenticated smoke test on a designated test area remain necessary before staff rollout. Android sensor accuracy/build still requires the user's Android Studio/physical device; this environment has no Android SDK.
