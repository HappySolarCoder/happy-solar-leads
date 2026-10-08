# Raydar mobile app — team distribution

Raydar now has Capacitor 8 iOS and Android projects. The existing Next.js screens,
images and fonts are packaged inside the app. Firebase email/password login and
Firestore use the existing Firebase project; `/api/*` calls use the existing HTTPS
backend through native HTTP, preserving the callers' bearer tokens. Web builds
continue using normal same-origin fetch and the existing PWA service worker.

This is a native container with the existing React interface, not a React Native
UI rewrite. There is no remote `server.url`, embedded server, or iframe.

## Current implementation and limits

- App ID: `com.happyslr.raydar`; display name: **Raydar**. Confirm this ID is available
  under Happy Solar's developer accounts before the first signed distribution.
- Native foreground precise-location permission, GPS watches, pause/resume cleanup.
- Existing map, territory, lead, stats and administrative screens are bundled.
- Android Back navigates within the app and minimizes it at home/login.
- Screen insets, keyboard resizing, native network status, branded icon and splash.
- Home-screen install prompts and web service-worker updates are disabled in native.
- Required-proximity users cannot bypass verification when GPS fails. Existing
  role and per-user proximity exemptions remain. This also fixes the web path.
- No background GPS or push notifications have been implemented.
- A network connection is still required for login, map tiles, API data and reliable
  saves. The offline banner is not a durable offline sync queue. Do not promise
  offline lead collection until a separately tested queue/conflict policy exists.
- The legacy browser Gemini key is deliberately excluded from mobile builds.
  Move that AI feature behind an authenticated server API before enabling it on phones.
- Native HTTP changes only `/api/*` calls. Any configured third-party notification
  webhook must allow the app's origin, or be moved behind an authenticated backend
  endpoint. Check this before relying on homeowner/manager notifications.

## Configure and build

Use Node 22+ and `npm ci`. Copy `mobile.env.example` to `.env.local` and fill it
with the **existing Firebase web app's public configuration**. Set
`NEXT_PUBLIC_API_BASE_URL` to the Raydar production or staging HTTPS origin (no path).
Use a staging Firebase project/backend for device QA when available.

Do not ship service-account JSON, Firebase admin credentials, signing material or
private API keys. The public Firebase API key identifies the Firebase project;
Firestore rules and authenticated API authorization still protect the data.
Verify Firebase/API-key restrictions permit the installed app's WebView origins
(`capacitor://localhost` on iOS and `https://localhost` on Android). Never loosen
Firestore rules to make a device build work.

```bash
npm ci
npm run mobile:test
npm run mobile:build
npm run mobile:sync
```

The build uses `.mobile-build/` as an isolated static-export workspace, excludes
`app/api`, and copies the result to `out/`. It never moves source routes or copies
`.env` files. Generated bundles and platform PNG assets are ignored by git. `mobile:build`
regenerates icons and splash screens from the committed `resources/logo.png`. Missing required configuration
fails the build. Rebuild and sync after any UI, configuration or plugin change.

### iPhone pilot with TestFlight

1. On a Mac, install Xcode 26+ and its command-line tools. This project uses Swift
   Package Manager; CocoaPods is not required.
2. Run `npm run mobile:ios`. In Xcode select the **App** target, Happy Solar's Apple
   Developer Team, automatic signing, and verify `com.happyslr.raydar`.
3. Test first on a connected iPhone. Verify login, returning after force-close,
   location denied/allowed/precise, map loading, a test lead save, and keyboard layout.
4. Create the matching App Store Connect record. Increment the build number, choose
   a generic iOS device, then **Product → Archive → Distribute App → App Store Connect**.
5. In TestFlight, create a staff pilot group. Employees who are not App Store Connect
   users should be **external testers**, even though they work for Happy Solar.
   The first external build needs Apple's beta review. Invite named testers rather
   than enabling an unrestricted public link. Provide an authorized review account.
6. TestFlight builds expire after 90 days. Use it for the pilot, not permanent
   unattended distribution. After the pilot, use a private Custom App via Apple
   Business Manager if the organization is enrolled. This requires Apple's review.
   If that is unavailable, assess Apple's unlisted-app route; an unlisted link is
   not access control, so staff login and backend authorization must remain enforced.

No Apple account, signing certificate, paid enrollment, submission or invitation
has been created by this change.

### Android pilot

1. Install Android Studio 2025.2.1+ with Java 21, SDK Platform 36 and Build Tools 36.
2. Run `npm run mobile:android`, connect a device and run the App configuration.
3. For a quick technical pilot, Android Studio can build a debug APK. That APK
   requires sideloading and is not the release/update identity for Google Play.
4. For staff testing through Play, generate a signed **Android App Bundle** from
   Android Studio. Create and securely retain Happy Solar's upload keystore; enable
   Play App Signing and upload to an **internal testing** track. Add the chosen
   testers and share the opt-in link. Do not publish to production.
5. The internal track supports up to 100 testers. Use a closed track for a larger
   pilot, or Managed Google Play private distribution if devices/accounts are managed.

For repeatable Android debug builds, set the public configuration values from
`mobile.env.example` as GitHub repository **Actions variables**, then run
**Build internal Android app** manually from the branch containing this workflow.
It generates a debug APK artifact and does not publish it. This repository is
public: do not put private resources into the artifact or treat its download as
restricted staff access. Use Firebase authentication and authorization regardless.
The workflow has been supplied but has not been executed in this environment.

## Required device acceptance test

Use a designated test user and test lead. Do not reset/import/delete production data.

| Flow | Expected result |
| --- | --- |
| Fresh install → sign in | Existing credentials work; mobile home opens |
| Force close → reopen | Session restores; correct user's data/permissions load |
| Logout → reopen → another user | No prior user's protected data remains accessible |
| Deny GPS / approximate-only / services off | Clear recovery instructions; proximity-required saves are blocked |
| Enable precise GPS → reopen map | Accurate position and nearby leads; fresh watch starts |
| Background → return repeatedly | Watch stops/resumes; no duplicate GPS activity or crashes |
| Disposition / pin near and far from address | Existing 50m policy and user exemptions work |
| Map, lead detail, appointment, go-back, stats | Reads and authorized writes work against the chosen backend |
| External call / SMS / maps links | Correct phone app opens and Return restores Raydar |
| API token expired / unauthorized | Denied request does not appear successful |
| Airplane mode → reconnect | Offline message appears; failure/recovery is clear; no false save success |
| Notched phone, rotation, large text, keyboard | Header, form controls, map and dialogs remain usable |
| Android Back | Returns within the app; home minimizes it |
| Web regression | Desktop and mobile browser login/map still work |

Location permission descriptions are included for both platforms. Background
location permissions/modes are not enabled. Complete Apple privacy and Google Data
Safety disclosures from the app's actual data flows before distribution/review.

## Validation recorded for this change

- Static mobile export built successfully with **synthetic public configuration**;
  this validates compilation, not production login, connectivity or lead writes.
- Six mobile transport/error unit tests, 34 existing user/territory/proximity
  regression tests, TypeScript checks, focused lint and the normal web production
  build pass.
- Browser visual QA could not run here because the browser binary download failed.
  Native layout and routing still require the physical-device checks above.
- Platform generation and Capacitor sync are validated separately from compilation
  in Xcode/Gradle. Physical-device, signing, TestFlight and Play tests remain required.

## Official references

- [Capacitor environment requirements](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Capacitor native HTTP](https://capacitorjs.com/docs/apis/http)
- [Capacitor location and permission descriptions](https://capacitorjs.com/docs/apis/geolocation)
- [Apple TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)
- [Apple Custom Apps](https://developer.apple.com/custom-apps/)
- [Google Play internal and closed tests](https://support.google.com/googleplay/android-developer/answer/9845334)
