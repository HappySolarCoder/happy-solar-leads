# Raydar v12.5 — refreshed homeowner coordinates

This mobile update consumes the October 11, 2026 in-place correction of the existing `homeowners` collection. It does not migrate or modify Firestore. The supplied correction report says 636,967 records changed; this release does not independently recount them.

## Coordinate path

- `app/homeowners/source.ts` still queries the existing `homeowners` collection with `orderBy("geohash")`, bounded start/end cursors and `limit(500)`. It uses `getDocsFromServer`, so a stale Firebase SDK cache cannot satisfy the refresh. No new query, listener, pagination or document lookup was added.
- `app/homeowners/model.ts` reads the current `lat`, `lng` and `geohash`. The local `geohash5` is derived from the first five characters of that current geohash. Viewport planning, filtering and distance checks use those canonical coordinates.
- `app/homeowners/CanvasLayer.ts` projects the parsed home's `lat`/`lng` directly. Its temporary projection cache is keyed by the parsed object, not its document ID; a newly read record with the same ID receives a new projection. There are no hardcoded coordinates or offsets for real homeowner pins. Fictional preview/test coordinates are isolated from the signed-in map.
- Original-position fields (`latOriginal`, `lngOriginal`, `geohashOriginal`, `coordSourceOriginal`) and the correction audit fields are not copied into the map model or used as coordinate fallbacks. No Firestore schema change is needed to accept the added metadata.
- Existing worked leads and their saved history remain untouched. This release refreshes the homeowner layer; it does not backfill historical lead records or rewrite recorded knock locations.

## One-time device refresh

The existing IndexedDB database `raydar-homeowners-v12` upgrades from version 1 to 2. On an existing install, its `tiles` and `meta` stores clear together in the version-upgrade transaction. This removes old homeowner positions, old geohash coverage receipts (including empty ranges), and cache size metadata for every account cached on that device. Retaining old coverage receipts would incorrectly suppress fresh reads.

An ordinary restart at version 2 preserves the refreshed cache. A fresh installation creates empty stores normally. The 30-day TTL, cache size limits, serial query worker, 500 ms map-idle delay, 500-document query limit, maximum 2,000 reads per viewport and maximum 12 queries per viewport are unchanged.

The reset performs local storage operations only. New reads happen only through normal viewport requests as users browse. Previously cached areas will need fresh reads once per device/account as they are revisited; those ordinary Firestore reads are billable under the existing plan. There is no collection scan, bulk re-read, backfill, client write to `homeowners`, rules/index deployment or paid geocoding call.

Install and first open online. Offline immediately after upgrading, the obsolete homeowner cache is intentionally unavailable until a normal online viewport fetch populates it. Refreshed areas remain available offline afterward. Saved leads, pending field/outbox work, login state and unrelated storage are not cleared.

## Install on the Mac mini

Save `raydar-v12.5.zip` to Downloads, then paste:

```bash
ditto -x -k "$HOME/Downloads/raydar-v12.5.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v12.5" &&
bash scripts/mobile/install-android.sh
```

The existing installer reuses `.env.local` from a previous download (starting with v12.4), installs dependencies, builds the configured mobile app and opens Android Studio. Select the Galaxy S25 and click Run. Update the existing app; do not uninstall it or clear Android app storage to refresh pins. No Firebase or Vercel deployment is required for this change.

Android versionCode 125/versionName 12.5; iOS build 125/version 12.5. This is source for the local build, not a prebuilt APK. The source archive excludes local environment files, dependencies and test build output. No production website deployment or GitHub publication was performed for this release.

## Verification and remaining live check

See `VERIFICATION-V12.5.json` for the completed checks. The mobile static export uses synthetic Firebase configuration to verify compilation and types, not to install or prove live access. The cache browser test uses fictional records and blocks all remote requests. It verifies an actual IndexedDB version-1 upgrade, all-account cache/receipt removal, unrelated pending-work preservation, normal viewport refill, corrected canvas location, and zero repeated queries after reload or offline reuse.

The requested live spot-check is `homeowners/91-edgebrook-ln-irondequoit-ny` in project `gen-lang-client-0395385938`. One exact read was attempted; Firestore returned HTTP 403 / `PERMISSION_DENIED` without an authenticated Firebase session. The corrected live coordinates were therefore not retrieved, and rooftop alignment for that address is **not verified** by this release. No permission bypass or rules change was attempted.

After installing, sign in, open Knock online, navigate to 91 Edgebrook Ln in Irondequoit, enable homeowner pins and zoom into satellite imagery. Confirm the selected homeowner address is 91 Edgebrook Ln and its circle is on the correct house. If it is still misplaced, use the Firebase bot to read that exact document's current coordinates and `apPointType`/`coordSource`; do not re-import, backfill, or change the whole dataset. Parcel-fallback records may still sit off the rooftop even when their corrected coordinates load correctly.

Reproduce the code checks:

```bash
npm run mobile:test
node scripts/mobile/check-export.mjs
CHROMIUM_EXECUTABLE=/path/to/chromium node scripts/mobile/check-homeowner-cache-v125.mjs
```

The browser script also supports Playwright's installed Chromium when `CHROMIUM_EXECUTABLE` is omitted. Physical Android/iOS compilation and the installed phone require the user's local toolchain/device.
