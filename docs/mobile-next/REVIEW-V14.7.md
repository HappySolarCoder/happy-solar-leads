# v14.7 verification

Story: a rep dispositions a door, sees its updated pin and continues knocking while the durable queue commits to Firestore. Managers draw and assign large territories through paged authenticated handlers; iPhone users invoke native dictation from their note draft.

| Boundary | Result | Evidence |
|---|---|---|
| Production web bundle | PASS | `npm run mobile:build`; Next compile and TypeScript checks; production project/API assertions; bundled version 14.7/147 |
| Platform assets / Capacitor copy | PASS | iOS and Android cap sync completed, bundle manifests checked; portable dependency paths restored after build-host symlink resolution |
| Automated logic | PASS | 114 tests, 0 failures, including assignment beyond 400 pins / 1,000 scanned records and confirmed-knock snapshot lag |
| Browser → territory API → data → response | PASS, synthetic | Actual screens and route handlers with in-memory Firestore: 450-pin create, rename, transfer, partial deletion and retry on 393px iPhone / 360px Android viewports |
| Territory drawing and server capability | PASS, synthetic | Unnumbered draggable handles; old-server response produces update guidance, keeps drawing and makes no legacy preview request |
| Knock controls | PASS, browser | Controls align at 44px with spacing; initials opens account/tools; GPS at lower right above Focus; My/Team/Off, Zoom to mine and startup/reopen recenter retain behavior |
| Save → pin | PASS, synthetic | Delayed listener after confirmed write keeps latest pin status; normal saves render no save/sync notification |
| Offline / retry | PASS, synthetic | Reload survives, original knock timestamp retained, reconnect sends once, lost acknowledgement retries without duplicate history; recovery only for genuine failed/prolonged pending actions |
| Reporting contract | PASS, synthetic | Seven disposition paths; timestamps, actor and GPS, ownership preservation and scheduling payload validated; no live writes |
| Native iOS speech | PENDING | Native plugin, bridge registration, plist permissions and project references implemented. Xcode compilation and microphone/permission testing require Mac/iPhone. No claim of physical-device acceptance |
| Native Android regression | PENDING | Existing speech Java unchanged; physical/emulator check on user's Mac remains |
| Live large territory integration | PENDING | Companion prepared, not deployed. Must verify capability from live service after authorized deployment |

Browser checks use Chromium with simulated safe areas, not Safari/WKWebView or Android WebView. Remote traffic is mocked or blocked. Native compilation was not possible on this Linux host. No website, Firebase, App Store, TestFlight or GitHub publication occurred.

Reproduce isolated checks:

```bash
npm run mobile:test
node scripts/mobile/check-export.mjs --audit
node --import tsx scripts/mobile/check-field-polish-v147.mjs
node scripts/mobile/check-saves-v147.mjs
```

Set up Chromium for the check scripts before running them outside the build host. Never install the synthetic audit export as the real app. Use the installer commands in FIELD-V14.7.md for the production-configured native test build.

Native implementation references: https://capacitorjs.com/docs/ios/custom-code and https://developer.apple.com/documentation/speech/recognizing-speech-in-live-audio .
