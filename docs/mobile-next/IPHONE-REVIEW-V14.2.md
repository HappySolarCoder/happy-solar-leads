# Raydar v14.2 / build 142: sign-in startup correction

## Evidence and diagnosis

The Mac log supplied on October 11, 2026 showed v14.1's native Xcode build succeeded. Its launcher then failed opening the obsolete Simulator.app path before installing the build. The manual install command bypassed that issue. The subsequent screenshot shows `Raydar v14.1 · build 141` and `Sign-in is taking too long to respond`, so this is now Firebase Auth session initialization, before the user-profile read or map queries.

The shipped Firebase JS SDK 12.9.0 browser getAuth initializer includes browserPopupRedirectResolver. On iOS/mobile browsers it proactively awaits that resolver's Google script/iframe initialization before delivering the initial auth-state callback. Raydar only uses email/password sign-in. Native startup was unnecessarily dependent on that browser redirect flow.

The regression harness reproduced the exact failure mechanism with the real installed SDK and an iPhone user agent: withholding the unused Google script callback kept auth state pending beyond the app's 12-second timeout. The corrected native initializer completed without a popup request. This demonstrates a concrete code defect matching the screenshot; confirmation that it resolves this Mac's full live login still requires installing v14.2 there.

## Changes

- Native iOS and Android initialize Auth explicitly without popup/redirect dependencies. The web app retains getAuth.
- The persistence hierarchy remains IndexedDB, browser local storage, then browser session storage. Firebase app names and storage keys are unchanged. There is no cache reset, simulator erase, app uninstall, account sign-out, or offline-draft deletion in this update.
- Auth initializes before Firestore; an `auth-config-native` startup stage is logged without credentials or user data.
- Xcode 27 Device Hub and older Simulator.app are both supported. Installation and launch happen before the optional viewer-open step, which can no longer abort either operation. Manual Device Hub instructions appear if automatic opening fails.
- Both installers can reuse v14.1's `.env.local`. Native release metadata and visible labels are v14.2/build 142.

The change adds no Firestore queries, listeners, collections, backfills, schema/index/rules changes, or homeowner writes. Existing direct disposition and scheduling flows are retained. Nothing is deployed to Vercel or uploaded to Apple by this delivery.

## Verification

See `VERIFICATION-V14.2.json` for completed checks and their limits. The focused Auth check runs the real Firebase client SDK with intercepted fictional Auth responses. It tests the former startup stall, fresh native startup, invalid credentials, password sign-in, IndexedDB session restoration, existing local-storage session restoration, Android startup, and persisted sign-out. No production account is used.

The React startup checks cover the approved logo/current version, one profile read after sign-in, profile timeout/retry, handling late responses, avoiding duplicate sign-in requests, invalid-credential recovery, and app-resume networking. Those UI checks use isolated transports and Chromium, not WKWebView.

Physical iPhone acceptance and real Scheduling Manager delivery remain unverified here. The prior missing Manage Users backend route is not addressed by this client-only release; see `IPHONE-REVIEW-V14.1.md`. Previously inactive field capture stays off. No production lead or user data was changed during validation.

## After installing on the Mac

1. Confirm `Raydar v14.2 · build 142` on the login or recovery screen.
2. Confirm the login form appears, or the existing signed-in account opens Today.
3. Sign in with the normal Raydar account; confirm Today, then Knock, opens.
4. Close and reopen Raydar without uninstalling; confirm the sign-in session restores.
5. If startup still fails, share the exact new message and Xcode's `[Raydar 14.2/142]` stage lines. Do not share passwords or tokens. A profile timeout is a separate stage from this session timeout.

## References

- Firebase Auth dependency guidance: https://firebase.google.com/docs/auth/web/custom-dependencies
- Firebase SDK issue describing Capacitor/browser-resolver initialization: https://github.com/firebase/firebase-js-sdk/issues/5019
- Apple Device Hub: https://developer.apple.com/documentation/xcode/managing-your-simulated-and-physical-devices-in-device-hub

Changed files relative to the delivered v14.1 package are listed in `CHANGED-FILES-V14.2.txt`.
