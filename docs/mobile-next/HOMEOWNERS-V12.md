# Homeowner map layer (included in v12.2 and v12.3)

The supplied brief describes the existing `homeowners` collection in Firebase project `gen-lang-client-0395385938`. This implementation does not import, edit, delete or link its records. It adds no write path for homeowner data and never creates a lead during matching or tapping.

## Map behavior

In v12.3, gray property marks are small centered circles (owner) or diamonds (**Suspected renter**) so roofs and trees remain visible. They are 6–8 CSS pixels, with a 24-pixel nearest-home tap radius; only the selected home expands to 16 pixels. The boolean `suspectedRenter` takes precedence even when false; otherwise the raw absentee value supplies the estimate. The detail sheet labels occupancy as an estimate. Worked pins retain their disposition, Signal R/roof accent, GHL result and selection appearance at smaller visual sizes, with 44-pixel tap targets.

Matching is device-side: normalized street and municipality/city first, then the nearest loaded lead within 25 meters. Unit suffixes are removed. Multiple records for the same normalized house use the latest recorded visit. Unmatched leads remain. The merge knows only the leads available to the signed-in account, not other users' private/unloaded history. No gray pin is drawn for a matched record, even when an active map filter hides the worked pin.

Tap a gray pin to view the owner and secondary property details. Existing lead details gain the same owner section when opened from a matched map pin. The compact Homes button also opens a searchable list of visible saved records (25 rows at a time). Homeowner pins can be disabled under Map filters & tools; the preference is per account. Filters for outcomes/status/solar quality/customers hide the unworked layer so results stay consistent.

## Read and rendering limits

- The only Firestore query is in `app/homeowners/source.ts`: one-time `getDocsFromServer`, ordered by `geohash`, with both start/end cursors and `limit(500)`. There is no collection scan, pagination loop or `onSnapshot` for homeowners, including preview/debug pages.
- Queries run after 500 ms of map idle, at zoom 15 or higher, and only for a visible-area circle with radius at most 2.5 km. Larger desktop viewports must zoom closer. GeoFire bounds are divided at geohash5 boundaries and client rendering filters false positives.
- A serial worker cancels pending ranges when the camera moves. Firestore does not support aborting an already-sent `getDocs` request: that request can still be billed, and its valid bounded result is cached, but stale data never replaces the new view.
- Each idle view is capped at 12 queries and 2,000 returned/minimum-query reads. This counter is not a billing meter: Security Rules profile checks, retries and Firebase billing details can add reads. Dense/partly covered areas ask the rep to zoom closer. No background catch-up scans run.
- One canvas renders up to 2,000 gray homes in the viewport with cached SVG sprites, a spatial tap index and map-pane transforms. Existing worked markers keep their current implementation. No extra DOM marker per homeowner, continuous GPS service or paid imagery provider is added.

## Cache correctness and offline use

IndexedDB persists minimal homeowner fields by Firebase-project/account/geohash5. Each tile has coverage receipts with a 30-day freshness period. A successfully queried range with fewer than 500 raw results is complete for that range. A whole tile is marked complete only if those ranges cover its entire hash interval. A limit-hit range stays partial and is not blindly retried until a closer zoom produces a narrower range.

All bounded query results, including geohash false positives, are cached before recording coverage. Only rendering is filtered to the view. Otherwise a later pan could incorrectly treat discarded houses as cached. Empty completed ranges also prevent repeat reads. Fresh coverage is reused after panning away/back or relaunching; missing/expired coverage alone is downloaded. Offline, existing saved records remain visible with their details, and unvisited areas make no requests.

In-memory reuse is limited to 12,000 records / 12 tiles per account loader and at most three account loaders. Device storage is bounded to 25,000 records, 64 tiles and approximately 24 MB across device account caches; oldest saved areas may be evicted. Evicted or expired coverage can cost reads on a later visit. Existing imagery providers' tiles are not bulk-downloaded. Offline homeowner records do not imply that an unvisited satellite image will be available offline.

The target budget in the supplied brief is an expectation, not a guaranteed price or fixed read count. Dense neighborhoods and zooming into a previously capped range can need more than 500 reads. Use a small pilot and the Firebase usage dashboard to verify actual reads. No live Firebase billing or production data was used for these tests.

## Firebase access (separate from Vercel)

This layer reads Firestore directly using the existing sign-in. No new Vercel API is required. The repository's current Firestore rules do not grant access to `homeowners`; live deployed rules could differ and have not been verified here.

If Raydar reports **Homeowner access is not enabled**, open Firebase Console → this existing project → Firestore Database → Rules. Review and add only the match block in `docs/mobile-next/firestore-homeowners-v12.rules.txt` inside the existing database-documents block, retain all other rules, then publish. Do not replace the full ruleset or enable public access. The added rule limits list queries to 500, checks an active approved account, and denies all client writes. Rules profile checks have their own read cost. The mobile code additionally requires a valid bounded street-level query; Firestore Rules cannot validate the full geospatial intent of those cursors.

No composite index is needed: queries use only the standard ascending index for `geohash`. No homeowner mutation or index deployment was performed during development. Existing lead/outcome permissions remain separate.

## Verification and device check

Tests cover renter override/fallback, field allowlisting, normalization, latest-visit/proximity matching, immutability, viewport coverage, zoom/radius guards, partial coverage, dense bounds, expiration, repeat/offline zero queries, stale result suppression, query budgets and 10,000-lead matching. Browser checks use a fictional 1,200-home map and the actual device-cache implementation, including relaunch/reuse, readable owner details and a single canvas.

Before rollout, test on the Galaxy S25: view a Rochester/Buffalo block, tap a worked pin and a gray pin, pan/zoom rapidly, return to the same area, then reopen offline. Check Firestore usage over several neighborhoods. A read spike approaching the whole collection is a release blocker. Actual native frame rate, production rules and your imported records still need this device/live-account verification.

Reference implementation guidance: https://firebase.google.com/docs/firestore/solutions/geoqueries and https://firebase.google.com/docs/firestore/security/rules-query .
