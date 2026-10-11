# Raydar v14.3 / build 143 — data loading repair and remaining diagnosis

## What the supplied simulator log proves

The v14.2 native Firebase auth initializer worked: the user signed in and the profile resolved in about 360 ms. Native API requests to goals and historical territory pins returned HTTP 200. Later auxiliary profile reads timed out and were printed as empty error objects by Capacitor. The map's live-listener callback discarded its actual Firebase error. Its cause is therefore **not confirmed** by that log.

`OS-PLUG-GLOC-0002` is a separate location failure. Setting a simulated Rochester/Buffalo location enables location testing; it does not repair Firestore or change homeowner coordinates.

## Changes

- Today calculates its daily target from the existing lead feed. Previously it called `getMyMonthlyKnocksAsync`, which read the profile and then fetched all scoped leads a second time (the entire leads collection for admins). Target progress now also responds to live lead changes, with actor attribution matching the Today counters.
- Native storage no longer warms the entire user directory when the module is imported. Directory loading waits for Firebase auth readiness without reading the profile again. Concurrent directory requests share one promise, and cached/in-flight results are tied to the Firebase account object.
- Live-listener errors include a known Firebase code in the app and native console, without raw exception messages, lead records, tokens, or document paths.
- Today and Knock have **Retry data**. A failed transient listener can restart on reconnect. Healthy listeners do not restart on every resume/network event, and successful knocks do not cause full refetches. Manual retries are rate limited to four seconds.
- A permission/auth/query failure clears visible live leads. A transient connection failure can retain already received pins. Account changes still clear prior-account data and rebuild the same authorized query scope.
- iOS logs `firestore-long-polling` to confirm the existing native transport setting. No speculative transport change: the installed Firebase SDK already defaults fetch streams off, and forced long polling was already enabled for native iOS in v14.2.
- Version/build become 14.3/143. The installer checks v14.2 first when locating the previous working `.env.local`.

## Verification

| Check | Result |
| --- | --- |
| Existing mobile unit suite | PASS: 103 passed, 0 failed |
| Actual Today/provider/live-hook/storage in isolated Chromium fixtures | PASS: one initial profile read, no duplicate goal lead fetch, no eager directory read, live goal updates |
| Listener failures/recovery | PASS: permission denial clears pins, manual retry restores feed, transient reconnect recovery, healthy reconnect avoids another subscription |
| Account/directory isolation | PASS: directory deduplication, new account refresh, previous leads cleared, rep assigned/claimed queries restored |
| Actual React login/startup regression harness | PASS: current brand/version, timeout/retry, late response handling, no duplicate sign-in, native resume |
| Production-configured static export / TypeScript | PASS |
| Native iOS asset generation / Capacitor sync / bundle identity | PASS: 14.3/143, approved brand, production API and Firebase project |
| Production live lead connectivity on the user's simulator | NOT VERIFIED; install and inspect new code if failure remains |
| Native Xcode compilation and physical iPhone/Android field acceptance | NOT RUN in this Linux environment |
| Real rep test knocks, scheduling webhook delivery and reporting counts | NOT RUN; no production write tests performed |

Evidence: `VERIFICATION-V14.3.json`. Changed files: `CHANGED-FILES-V14.3.txt`.
Reproduce the isolated checks with `npm run mobile:test`, `node scripts/mobile/check-data-loading.mjs`, and `node scripts/mobile/check-ios-startup.mjs` (the browser harnesses currently use the validation environment's `/tmp/raydar-browser/chromium`; adapt that path on another machine). Build with the normal installer.

No deployment to Vercel, change to main, schema/rules/index change, bulk homeowner read/write, or test database mutation was performed. Query limits, lead write schema, claim semantics, outbox, appointment hooks, branding and Android feature set remain as in v14.2. The v14.2 audit's 42 dependency advisories are not resolved by this release.

## Next simulator check

Run the full installer in `IPHONE-V14.3.md`; launch-only does not update the installed bundle. Expect **Raydar v14.3 · build 143**, then open Today and Knock. In another Terminal tab, set test GPS:

```bash
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.3" &&
npm run mobile:ios:location -- rochester
```

If the map still cannot load, share its displayed code (for example `permission-denied`, `failed-precondition`, or `unavailable`) and the adjacent `leads-error` console line. Do not loosen Firestore rules based on a generic connection message. A code-specific check of deployed permissions/query prerequisites or device connectivity is still needed if the error persists.
