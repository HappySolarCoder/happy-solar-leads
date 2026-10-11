# Raydar v14 iPhone preparation — verification

Checked October 11, 2026. Baseline: v13 commit 34c160e. Host: Linux; no Xcode or connected iPhone is available in this build environment.

| Check | Result | Evidence / limit |
| --- | --- | --- |
| Existing mobile regression tests plus new simulator selection/location tests | PASS | 94 passed, 0 failed, 0 skipped (`npm run mobile:test`). Fixtures only; no live writes. |
| Production-configured static screen export and TypeScript | PASS | Actual production Firebase public config/API origin; all 51 routes exported by `scripts/mobile/build.mjs`. No fixture aliases. This does not verify signed-in network operations. |
| iPhone icon and launch assets | PASS | `npm run mobile:assets:ios`; opaque 1024x1024 app icon, six 2732x2732 splash images, approved logo/colors. |
| iOS native project sync | PASS | `npx --no-install cap sync ios`; copied bundled screens/config and resolved the five plugin declarations into the Swift package manifest. No Swift compilation performed. |
| iOS bundle configuration | PASS | Expected com.happyslr.raydar.next bundle ID, local web bundle, no server.url, no web service worker, ivory background, native keyboard resize. |
| Shared Xcode scheme / plist source | PASS | XML/plist parse; scheme references the existing App target and archives Release; foreground-location usage text present. |
| Installer syntax / dependency lock consistency | PASS | Bash/Node syntax checks, git diff check, npm ci --dry-run --ignore-scripts --offline. The dry run is not a fresh macOS install. |
| Simulator target safety | PASS | Tests reject unavailable devices, non-iPhone simulators and physical-device identifiers, reuse the selected/running iPhone, reject invalid GPS input. Launcher never uninstalls or erases a simulator. |
| Xcode Swift build, simulator boot and actual clicks | NOT RUN | Requires the user's Mac and installed iOS runtime. Run the provided simulator installer. |
| Signed archive, TestFlight upload and Apple processing/review | NOT RUN | Requires the user's active paid Developer Program team and App Store Connect. No signed IPA or Raydar TestFlight link has been created here. |
| Real-iPhone GPS, compass, keyboard dictation, phone handoff and field performance | NOT RUN | Needs a physical iPhone. Simulator cannot prove these. |
| Production lead readback, scheduling webhook delivery and reporting attribution | NOT RUN | No real account/device test actions performed. Prior live-verification limitations in FIELD-V12.6.md still apply. |

The first full iOS build command completed the screen export but failed at the legacy capacitor-assets/Sharp 0.32 native binary. Replaced the iOS asset step with `ios-assets.mjs` and an explicit Sharp 0.34.5 dependency. The corrected asset step and iOS sync then passed. The existing Android asset command was not changed.

## Changes relative to v13

- MOBILE-APP.md
- android/app/build.gradle (version only)
- app/mobile/more/page.tsx (version text only)
- docs/mobile-next/IPHONE-V14.md
- docs/mobile-next/VERIFICATION-V14.md
- ios/App/App.xcodeproj/project.pbxproj (version only)
- ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme
- ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json (generated formatting)
- ios/App/App/Assets.xcassets/Splash.imageset/Contents.json (generated formatting)
- package.json
- package-lock.json
- scripts/mobile/install-android.sh (v13 configuration fallback only)
- scripts/mobile/install-ios.sh
- scripts/mobile/ios-assets.mjs
- scripts/mobile/ios-simulator.mjs
- tests/mobile/ios-simulator.test.ts

No lead/disposition/map query logic, Firebase rules/indexes, production records, website deployment, or scheduling endpoint was changed. The iPhone app and simulator use the existing production Firebase/API configuration; simulator writes made by the user are real writes.
