# v14.8 verification and handoff

The release changes the shared mobile app for iPhone and Android. Native containers retain bundle ID com.happyslr.raydar.next and version 14.8/build 148. Verification below distinguishes isolated fixtures from production/device proof.

| Check | Result | Evidence / limit |
|---|---|---|
| Production-configured mobile export | PASS | Next compile and TypeScript passed; manifest asserts production API origin and Firebase project; no fixture adapter in production bundle |
| Both native bundles | PASS, assets/sync only | Generated Signal R icons; Capacitor sync iOS/Android; each copied bundle verified as 14.8/148; portable dependency paths retained |
| Automated unit/handler checks | PASS | 123 tests, no failures; territory geometry/ownership, pagination/retries, homeowner coverage, direct writes and feedback permissions |
| UI → territory handler → data → response | PASS, synthetic | 393px/360px browser viewports: 450-pin create/rename/transfer, partial deletion/retry, capability error keeps drawing, controls/layout |
| Repeated navigation and GPS cleanup | PASS, browser | Admin, manager and setter: 12 cycles each through five tabs, 180 transitions; one map/Focus control; GPS watchers zero off map, one on map; no duplicate-key errors |
| Browser memory and request reuse | PASS within tested workload | After GC, retained heap growth about 3.1–3.8 MB; personal endpoint called 4 times for admin and 3 for other roles, map endpoint twice per role across cycles. Not physical-device or production-volume performance evidence |
| Dictation registration | PASS, code/static guard | SceneDelegate uses/reuses RaydarViewController; storyboard and bridge register RaydarDictationPlugin. Swift compilation and actual speech capture NOT tested here |
| GPS retry / Zoom to mine twice | PASS, browser | Denied GPS remains retryable; retry clears warning; repeated territory zoom produces no false empty state |
| Seven disposition paths | PASS, synthetic | Exact status IDs, typed Timestamp writes, original time, rep uid/name, GPS, no ownership changes on disposition; writes only leads |
| Offline/reload/reconnect | PASS, synthetic | Durable draft survives document reload, automatic sync retains original knock time; lost acknowledgement does not duplicate history |
| Scheduling request | PASS, synthetic only | Existing webhook payload, contact edits saved before send; real webhook delivery from physical iOS/Android NOT tested |
| Immediate save state | PASS, browser/fixtures | Disposition remains visible with delayed snapshots; notes survive acknowledgement/reopen; explicit claim/unclaim changes UI; cleared follow-ups remain cleared after navigation |
| Voice feedback | PASS, synthetic/browser | Chromium fake microphone recorded real audio bytes; failed upload kept queue; retry confirmed once; handler enforces owner/admin/type and idempotent object creation |
| Live new backend routes | FAIL / NOT DEPLOYED | Unauthenticated production mobile-leads and mobile-feedback probes return 404; territory route returns expected 401 but paged capability not proven |
| Native Xcode/Android binary compilation | NOT RUN | Linux host; no signed IPA/APK created here |
| Real iPhone/Samsung, heat, battery, long-session white screen | NOT RUN | Requires physical devices; browser results are not proof these symptoms are fully resolved |
| Live rep knocks / reporting endpoint | NOT RUN | No real account test writes performed; do not claim reporting acceptance until approved test leads and metrics are checked |
| Firebase billing unchanged | NOT VERIFIED | Viewport caps/cache retained; new read paths and audio Storage have usage-dependent cost. Measure a small pilot; see server guide |

No production data was modified by tests. Firestore rules, indexes, homeowners schema and corrected coordinate fields are unchanged. The read-only production probe sent no credentials. Source upload and download packaging do not deploy the website/backend or upload to TestFlight.

## Reproduction

```
npm run mobile:test
npx tsc --noEmit
node scripts/mobile/check-export.mjs --audit
node --import tsx scripts/mobile/check-field-polish-v148.mjs
node --import tsx scripts/mobile/check-saves-v148.mjs
node scripts/mobile/check-stability-v148.mjs
npm run mobile:build
npx cap sync ios
npx cap sync android
node scripts/mobile/check-bundle.mjs ios/App/App/public
node scripts/mobile/check-bundle.mjs android/app/src/main/assets/public
```

Browser scripts use /tmp/raydar-browser/chromium in this build host; adjust executablePath for an installed Playwright Chromium elsewhere. The audit export uses isolated synthetic Firebase adapters and must never be installed as the company app. The normal installers always run the production build, not the audit build.

VERIFICATION-V14.8.json contains the saved test results. CHANGED-FILES-V14.8.txt lists changes since v14.7. FIELD-V14.8.md contains Mac commands and physical acceptance; SERVER-V14.8.md contains the exact bot/deployment handoff.
