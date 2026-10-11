# v14.1 startup repair and iPhone review

Read [the parity and verification report](IPHONE-REVIEW-V14.1.md) before team rollout. Install this update with the full installer below. The launch-only command does not install new builds.

# Raydar v14.1: first iPhone pilot

This package contains all shared Android v13 features, the v14 iPhone setup, and the v14.1 startup, connectivity, and offline-preparation fixes. It uses the same slate-blue/yellow branding, homeowner pins, compact knock pins, NH/NI/GB/CSM actions, direct Firestore writes, and offline outbox. It is a Capacitor iOS app: bundled React screens running in Apple's native WebView, with the existing native location, keyboard, network and HTTP integrations.

The ZIP is source code for your Mac to compile. It is not a signed IPA or an active TestFlight download link. Native compilation, signing and Apple's processing happen on your Mac and Apple account. No production website, Firestore schema, rules, indexes, backend routes, or homeowner data are changed by this release.

## 1. Run it as a virtual iPhone on the Mac mini

You do not need to own an iPhone. Apple's Simulator displays the actual iOS app in an interactive iPhone window. Click to tap, drag to swipe, and hold Option while dragging for a two-finger gesture such as pinch zoom. It is different from previewing a phone-sized page in a desktop browser.

Prerequisites:

- Full Xcode 26 or newer in Applications. Your previously reported Xcode 27 meets the minimum. Open Xcode once and finish any license/component prompts.
- Node.js 22 or newer. Your previously reported Node 24 meets the minimum.
- One iOS Simulator runtime and one available iPhone simulator. No paid Apple membership or signing team is required for a local simulator build.
- Enough storage. Given the earlier disk-full error, aim for roughly 25–30 GB of working space before installing a runtime and building. This is headroom, not a fixed Apple requirement; runtime/build sizes vary. You can check with `df -h "$HOME"`.

In Xcode, open Settings > Components (called Platforms in some versions), select an iOS Simulator runtime and install it. Install only one runtime to begin with. Alternatively, with Xcode installed in its normal location:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -downloadPlatform iOS
```

If Xcode has no virtual iPhone after the runtime is installed, use Window > Devices and Simulators > Simulators > +, choose an iPhone and the installed iOS version, and create it. In Xcode versions with Device Hub, use its Add Simulator control instead.

Save `raydar-v14.1-ios.zip` in Downloads, then paste:

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.1-ios.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.1" &&
bash scripts/mobile/install-ios.sh simulator
```

The installer checks Xcode and the simulator, finds `.env.local` in v14, v13, or an earlier Raydar download, installs dependencies, exports the screens, generates iOS icon/splash assets, syncs the native project, builds it without device signing, installs it on an available virtual iPhone, and opens it. The first build can take several minutes while Swift packages download. Subsequent native builds reuse their build cache. No phone needs to be plugged in. This command does not upload the app to Apple.

If the configuration is not found, copy `.env.local` from your last working Raydar project into the v14.1 folder and run the command again. Use the same Firebase web-app configuration as Android; this app uses Firebase's JavaScript SDK, so do not replace it with a GoogleService-Info.plist or create a new Firebase project.

To reopen the installed virtual iPhone app later without rebuilding:

```bash
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.1" &&
npm run mobile:ios:launch
```

To rebuild after editing app screens, rerun `bash scripts/mobile/install-ios.sh simulator`. To rebuild only the already-synced native project, use `npm run mobile:ios:simulator`.

### Put the virtual phone in the correct neighborhood

The simulator does not have your real phone's GPS. After starting Raydar, open a second Terminal window and run:

```bash
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.1" &&
npm run mobile:ios:location -- rochester
```

Use `buffalo` for Buffalo, or provide a latitude/longitude pair:

```bash
npm run mobile:ios:location -- 43.1566,-77.6088
```

Accept Raydar's location permission in the virtual phone and use the map's locate control. To clear the simulated location, run `npm run mobile:ios:location -- clear`. These commands change simulator GPS only; they do not move homeowner documents.

**This simulator is connected to the production Firebase project. Saving a knock changes a real lead and sending CSM sends a real scheduling request. Simulated GPS is what the app will record. Use a designated test lead for write testing.** Browsing maps also uses the normal production reads. Do not erase the simulator or uninstall Raydar while any knocks are unsynced.

You can test login, navigation, home layout, maps/imagery, pin selection, forms, keyboard layout and most data flows. A simulator cannot prove real GPS accuracy, compass heading, cellular calling, field battery behavior, physical-device performance, or hardware-specific permission behavior. iPhone note dictation uses the microphone on Apple's software keyboard; it is not the Android speech dialog and may not be available in Simulator. For the first field rollout, have an iPhone teammate check these on a real phone.

## 2. Make it downloadable on teammates' iPhones

Use TestFlight for this first pilot. It requires an active paid Apple Developer Program membership, but Raydar does not need a public App Store listing. Creating an App Store Connect record and uploading a build does not publish it to the public store. TestFlight builds expire 90 days after upload, so upload a replacement before expiry. This is a beta distribution channel, not a permanent internal release arrangement.

### A. Prepare Xcode for a signed build

From Terminal:

```bash
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.1" &&
bash scripts/mobile/install-ios.sh xcode
```

This rebuilds and syncs the current production-configured app and opens Xcode. It does not upload anything.

1. In Xcode > Settings > Accounts, sign in with the Apple account enrolled in your paid Developer Program. If enrollment is still pending, you can continue simulator testing while Apple completes it.
2. Select the blue App project on the left, then the App target, then Signing & Capabilities.
3. Enable Automatically manage signing and select your paid developer team. A Personal Team cannot distribute a TestFlight build. If you see Evan Day, check that this entry corresponds to your paid membership.
4. Keep the bundle identifier `com.happyslr.raydar.next`. The app's display name is Raydar Next; marketing version is 14.1 and build is 141. If Apple says that identifier belongs to a different team, resolve which team owns it before changing identifiers, because the bundle ID defines app identity and updates.
5. If automatic signing has not registered the identifier, register an explicit App ID with that exact bundle ID at developer.apple.com/account > Certificates, Identifiers & Profiles > Identifiers.

### B. Create the Apple app record once

Open https://appstoreconnect.apple.com > Apps > + > New App. Reuse an existing record with the same bundle ID if one already exists.

| Field | Value |
| --- | --- |
| Platform | iOS |
| Name | Raydar Next (or an available company-specific name if Apple reports a conflict) |
| Primary language | English (U.S.) |
| Bundle ID | com.happyslr.raydar.next |
| SKU | raydar-next-ios |
| User access | Your app administrators/developers |

The SKU is an internal Apple record identifier; teammates do not type it. They use their existing Raydar login after installation.

### C. Archive and upload

1. In Xcode's run-destination selector, choose Any iOS Device (arm64), or the generic iOS device destination. A simulator destination cannot produce the device archive for TestFlight.
2. Choose Product > Archive. Xcode builds the signed release and opens Organizer.
3. Select the archive > Distribute App > App Store Connect > Upload. Depending on the Xcode version, choose the standard TestFlight & App Store distribution option that uploads to App Store Connect. Avoid TestFlight Internal Only if ordinary staff will use external testing.
4. Follow signing/validation prompts and upload. Wait for Apple's processing to finish; the build then appears under your app's TestFlight tab.
5. If Apple flags Missing Compliance, complete the export-encryption questionnaire for the actual app/dependencies. This build has no hardcoded export-compliance answer; don't choose an answer merely to dismiss the prompt. Resolve any privacy or SDK validation messages shown in Organizer before distributing.

### D. Give the team an install link

Apple's word "internal" means App Store Connect account users, not everybody employed by Happy Solar. Ordinary FMAs can use External Testing without being given access to your Apple administration account.

1. In the app's TestFlight tab, create an internal tester group for your existing app administrators and add the processed build. This is also required before creating the external group in the current App Store Connect flow.
2. Create an External Testing group, such as Happy Solar iPhone Pilot, and add build 141.
3. Fill in the beta description, feedback email, What to Test, reviewer contact, and a working reviewer login. Use a least-privileged company-approved reviewer account; do not provide an admin account. Explain that Raydar is an employee canvassing tool, where to find the map, and that CSM sends a real scheduling request. Reviewer access must actually work; changing client source will not bypass Firebase roles or backend authorization.
4. Submit the first external build for TestFlight App Review. The first build needs Apple's approval before external users can install it.
5. After approval, invite teammates by email for a controlled pilot. If you specifically want one reusable install link, choose Create Public Link on the external group and set a tester limit. Anyone who receives or is forwarded that link can join the beta; the Raydar sign-in still controls access to company data.
6. Each teammate installs Apple's TestFlight app from https://apps.apple.com/app/testflight/id899247664, opens your invitation/link on their iPhone, taps Accept/Install, then signs into Raydar with their existing account.

The actual Raydar TestFlight link is created in your Apple account after upload, processing and any required review. There is no valid Raydar install link to supply before those steps. Downloading the source ZIP on an iPhone will not install the app. A separately exported IPA also needs the appropriate Apple signing/distribution path; it is not an Android-style unrestricted APK.

### Before the first field pilot

On at least one real iPhone, verify login, precise-location permission, map/imagery panning, opening homeowner and existing-lead pins, the NH/NI/GB forms, original-time offline sync and visible unsynced count. Verify one designated test scheduling request reaches the scheduling manager. Check the test lead documents and reporting attribution as described in FIELD-V12.6.md. A simulator run does not satisfy the requested physical-device proof.

For permanent private employee distribution, Apple's Custom Apps through Apple Business Manager is the next option to evaluate. It also has Apple review and organization setup, but avoids the TestFlight 90-day beta lifecycle. No public storefront listing is necessary for a Custom App.

## 3. What changed and what was verified

Added an iPhone installer, iOS-only asset/build commands, shared Xcode App scheme, simulator launcher, explicit simulated-location commands, setup tests, and this guide. The iOS asset generator now uses explicitly pinned Sharp 0.34.5, which was already in the dependency tree, instead of capacitor-assets' older nested native-image installer. Updated visible and native version metadata to v14.1/build 141 and added v14 configuration lookup. Existing map, homeowner, reporting and disposition logic is unchanged.

Validation results and remaining blockers are recorded in IPHONE-REVIEW-V14.1.md. The source is checked in a Linux build environment; macOS/Xcode compilation, signing, TestFlight processing and physical-device checks must run on the Mac/Apple account. No live Firebase writes, scheduling requests, Apple uploads or website deployments are part of the source verification.

## Official references (checked October 11, 2026)

- https://developer.apple.com/documentation/xcode/downloading-and-installing-additional-xcode-components
- https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices
- https://developer.apple.com/documentation/xcode/configuring-the-environment-of-a-simulated-device
- https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/
- https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/
- https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/
- https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/
- https://developer.apple.com/custom-apps/
- https://capacitorjs.com/docs/getting-started/environment-setup
- https://capacitorjs.com/docs/ios/deploying-to-app-store
