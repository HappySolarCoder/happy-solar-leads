# Raydar iPhone review — v14.1 / build 141

Reviewed October 11, 2026. Baseline: v14 commit b91fe2f, directly descended from Android v13 / v12.7. This release is an updated source package, not a signed IPA or a TestFlight upload.

## What the supplied log establishes

The log shows the local app at `capacitor://localhost`, WebView loaded, native splash hide, and a connected Wi-Fi network. It contains Apple keyboard/layout/privacy warnings but no Raydar authentication/profile-stage error or release identifier. It does not establish why startup hung, which package is installed, or whether the running logo is stale.

The v14 source and configured export already contained the approved slate-blue/yellow Signal R, latest Today/Knock screens, and prior Android changes. We cannot confirm the installed simulator build from that log. v14.1 adds a visible version/build to login, loading, recovery, and Account screens and verifies the bundled version, logo hash, core routes, Firebase project, and API origin before simulator installation. It updates the same app ID in place; no uninstall, simulator erase, cache wipe, or outbox deletion is used.

## Fixes in this release

1. Native email/password sign-in no longer waits for a duplicate Firestore profile read. The shared mobile provider performs the profile/approval check once.
2. Authentication restoration and profile loading have 12-second deadlines. A stalled read shows Try again / Reload app, rather than an endless loading screen. A missing profile shows a specific message instead of bouncing between login and Today. Late/previous-account responses cannot restore a stale session.
3. Native sign-in has a 15-second waiting message and reload action. It never starts another sign-in while the original is pending; a late successful sign-in can continue safely while the page is mounted.
4. Installed iOS uses Firestore's `experimentalForceLongPolling` connection option. Firebase's WebKit issue #9789 describes buffered responses and approximately 30-second waits. This is a targeted workaround, not proof of the cause on this user's simulator. Android and normal website transport remain unchanged.
5. Native profile reads for auxiliary account/management pages use the same bounded session handling.
6. Resuming the native app refreshes connectivity and wakes the existing outbox. It adds no database listener or timer and does not sync while the app is suspended.
7. GPS's first-fix spinner stops after its configured deadline, while the location watch remains able to deliver a later fix. A simulator with no supplied location is no longer shown as endlessly locating.
8. Preparing already-loaded doors offline was incorrectly disabled when field capture was deliberately off. It now works in direct mobile mode, storing data locally without additional cloud queries.
9. The mobile pilot-settings screen no longer offers capture toggles/save actions for unavailable field endpoints. Production capture remains off; advanced pilot tools are still intentionally inactive on both platforms.
10. Login input labels/autofill and version diagnostics were improved. New diagnostics emit stage, elapsed time and sanitized error code, not user records, passwords, or tokens.

No Firestore schema, indexes, rules, collections, lead history, status IDs, homeowner documents, or production deployment were changed during this review. No test knocks, appointments, deletions, or scheduling messages were sent to production.

## Feature parity and evidence

PASS below means code/isolated-test verification, not physical-iPhone acceptance.

| Area | Result | Evidence / remaining limit |
| --- | --- | --- |
| Latest shared mobile UI and brand | PASS | Shared React screens from v13/v12.7, Signal R assets, native build marker, visible 14.1/141 labels, checked exported bundle. |
| Today, local greeting, Follow-ups navigation, Stats, Account | PASS | 48-route screen audit at 393px and 360px; follow-up navigation and role restrictions exercised. Same device-local time helpers. |
| iPhone safe-area layout | PASS, simulated | Additional Chromium checks with 59px top / 34px bottom insets on six main screens. Actual keyboard and rotation still need iPhone/Simulator testing. |
| Startup and login recovery | PASS | Actual React components with isolated auth/profile transport: single profile read, stalled sign-in/profile, retry, late response rejection/recovery, invalid credentials, native resume event. |
| Production config | PASS, build | API `https://happy-solar-leads.vercel.app`; Firebase `gen-lang-client-0395385938`; default database. No remote server.url or native web service worker. |
| Native iOS Firestore transport | PASS, code | Option restricted to native iOS in tests; real iOS network speed/reliability remains unmeasured. |
| Map imagery toggle, compact worked pins, warm Signal R badge | PASS | Same LeadMap and fieldPin helpers; map selection remains visible; compact rendered dimensions verified in isolated Knock-page test. |
| Homeowner access, names, owner/renter information | PASS, code/tests | Same viewport loader/model, corrected lat/lng/geohash, cache version 2. No client writes to homeowners. Live Edgebrook address placement not re-read here. |
| Map cost controls | PASS, code | Existing geohash limits, 500-document cap, cached viewport coverage and rendering remain. No bulk import/backfill/read, new subscription or query introduced. |
| NH / NI / GB / CSM, all normal dispositions | PASS | Same LeadDetail/LeadEditor; Before you knock stays removed. Isolated fixture saves verified status, typed timestamps, newest history identity, GPS, objections and go-back fields. |
| Lead ownership and claim/unclaim | PASS | Existing helpers; disposition updates do not change ownership. Explicit claim/unclaim checked with fixtures. |
| Offline knocks / unsynced counter | PASS | Durable local queue survives reload, retries automatically on reconnect, preserves original knock time, handles lost acknowledgement without duplicate history. In-place installer preserves stored drafts. |
| Prepare doors offline | PASS | Enabled with capture off, writes an account-scoped prepared area to IndexedDB, no field API requests. Imagery is not downloaded. |
| Scheduling Manager request | PASS, contract only | Same payload and configured webhook, save-before-send order, native HTTP path. No live webhook or real phone call performed. |
| GHL appointment outcomes | PASS, code | Same live-lead/outcome mapping, personal outcome feed and permissions as Android. Live GHL-to-Firestore delivery was not triggered. |
| Territory rectangles / polygon drawing / town-ZIP search / sliding sheet | PASS, shared code/tests | Same editor, drawing geometry, search and collapsed drawing UI. Existing territory unit tests and page audit. No live territory mutation. |
| Territory assignment/deletion preserves pins | PASS, code/tests | Shared bounded user picker and existing backend transaction tests; deletion operates on territories, not lead history. Live endpoint returned expected JSON 401 without credentials. |
| Manage Users | BLOCKED in production | Shared screen and server handlers/tests are present. `/api/mobile-user-management` returned HTTP 404. Both Android and iPhone require backend deployment; see bot instructions below. |
| Foreground GPS / knock proximity | PASS, code only | Same Capacitor Geolocation plugin and existing rules; iOS usage descriptions, foreground lifecycle and watch cleanup reviewed. Accuracy/permissions need a real phone. |
| Compass | PRESENT; hardware unverified | Android uses its native compass plugin; iPhone uses DeviceOrientation/WebKit permission and heading handling. No sensor in Simulator can prove real compass behavior. |
| Voice-dictated notes | PRESENT; platform difference | Android uses its speech recognizer. On iPhone the button focuses the notes field and instructs the user to use Apple's keyboard microphone. No paid AI or custom iOS speech-recognition service was added. Actual dictation needs a real iPhone. |
| Focus, return reminders, team map | PASS, shared code/tests | Shared components and local metrics; team map/roles exercised. Reminders operate while the app is open, not as background notifications. |
| Advanced field pilots / recovery cards | INACTIVE on both | Per prior production requirement, native capture uses direct writes and skips the undeployed field routes. Pilot flags remain off. These should not be described as active features. |
| Native Swift compilation / Simulator run / TestFlight | NOT RUN here | This host is Linux, without Xcode, an Apple signing identity, or a physical iPhone. The source is ready for the Mac installer, not certified as device-tested. |
| Real-rep reporting readback | NOT RUN | No physical-device test knocks, webhook request, lead readback, or reporting-dashboard attribution proof was performed. Prior reporting acceptance remains outstanding. |

## Verification performed

- 100 automated tests passed, 0 failed or skipped, including six added timeout/transport tests.
- Production-configured Next static build and TypeScript passed; 51 generated routes (48 page source routes plus framework outputs).
- Isolated 48-page audit: no JavaScript page errors, horizontal overflow, unlabeled visible buttons, or broken internal link destinations in its scanned results. This is a page scan, not every possible live data state or every button on every page.
- Interactive navigation, map selection, team map, workspace, and role tests passed.
- Isolated actual Knock-page test passed for seven disposition paths, fixture-only lead saves, GPS/history/ownership fields, offline reload/reconnect, unsynced counter, replay, webhook payload, and claim/unclaim.
- Focused startup tests passed in Chromium with native bridge/auth fixtures. iPhone safe-area/offline preparation checks passed with synthetic insets.
- iOS assets generated, Capacitor iOS sync and bundled identity check passed. Plist/asset/scheme structure and source permissions reviewed.
- Linux WebKit browser execution could not be completed: required shared libraries were absent and the host denied the dependency installer's user/group changes. Chromium checks are not represented as WKWebView or real-iPhone tests.

## Public backend checks (no login credentials; no mutations)

| Route | Observed result |
| --- | --- |
| `/api/territory-management` | Expected JSON 401: deployed, requires authentication. |
| `/api/mobile-user-management` | HTTP 404: not available. |
| `/api/field-config` | HTTP 404: not available; native knocking does not call it. |
| `/api/field-work` | HTTP 404: not available; native knocking does not call it. |

The connection workaround changes transport, not query volume. No new cloud reads are added by the workaround or offline preparation; removing the duplicate sign-in profile read avoids that redundant read. Actual billing/connection behavior was not measured, so this is not a promise of a fixed bill.

## Prompt for the backend bot — Manage Users only

Use the attached v14.1 source ZIP, not a guessed GitHub branch. Deploy only the missing authenticated Manage Users backend to the existing `happy-solar-leads` Vercel production project at `https://happy-solar-leads.vercel.app`.

1. Compare and bring over `app/api/mobile-user-management/route.ts` and its implementation `app/utils/server/mobileUserManagement.ts`. Reuse the production `app/utils/firebase-admin.ts` helper and existing server-side Firebase configuration for `gen-lang-client-0395385938` / `(default)`. Do not ship server credentials to the mobile bundle.
2. Preserve the existing route's authentication, active-approved-admin authorization, self-deletion prevention, version conflict checks, bounded territory cleanup, retry behavior, and audit records. Deleting an account must preserve all `leads` and knock/appointment history. Do not run an actual deletion as a deployment test.
3. Run the included `tests/mobile/user-management.test.ts` tests against the handler and type-check/build the backend. If production's Admin helper shape differs, adapt the import/helper only while keeping authorization and behavior intact.
4. Deploy this backend-only change through the production project's normal deployment process. Do not change web UI, Firestore rules/indexes, field capture flags, homeowners, or existing lead records. Do not enable `/api/field-work` to fix this.
5. Verify an unauthenticated GET to `/api/mobile-user-management` returns HTTP 401 with `{"error":"Sign in again to manage users."}`. Then use an authorized admin for a read-only directory check. Report deployment URL/commit and the results.

## Acceptance still needed on a real iPhone

Install v14.1 in place. Confirm the label says `Raydar v14.1 · build 141`. Test sign-in/relaunch with the same rep used on Android, then map pan/zoom and lead details. Use a designated test lead to verify location permission/accuracy, heading, keyboard dictation, one offline knock followed by reconnect/resume, and one authorized Scheduling Manager handoff. Read those lead docs back and verify reporting attribution before claiming real-device parity. Simulator actions use production data; do not create arbitrary test activity.

See `CHANGED-FILES-V14.1.txt` for the exact changed-file list and `IPHONE-V14.1.md` for Terminal and TestFlight instructions.
