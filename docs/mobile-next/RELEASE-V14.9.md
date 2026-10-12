# Raydar 14.9 (149)

Both platform packages use the same application code and production Firebase/API configuration.

- Territory: one Save territory action. No preview scan or phone-driven assignment loop. A Cloud Tasks worker resumes persisted 200-pin batches after leaving the app. Backend setup in BOT-ONLY-V14.9.md is required first. Missing capability keeps the drawing and explains the update requirement. Failed queue submission keeps the saved boundary and offers retry.
- Worked pins: outcome icons appear from zoom 17, two levels earlier, at compact 22/24px widths. Farther out remains dots. Homeowner circles, unworked warm pins, map imagery and query budgets are unchanged.
- Knocks: details close after durable device storage. NI/GB close after their required forms are submitted; CSM keeps its contact/send/call flow. Pin updates locally while sync continues.
- GPS: captured quietly immediately after saving locally, with a bounded capture window and existing proximity checks. Failed or expired capture stays visibly unsynced for review. It will never use a location collected hours later for an earlier knock. Review and discard/re-record an unverified knock while at the home; Retry save does not bypass verification.
- Details: width constrained to the viewport; vertical scrolling retained.

Validation: see v14.9 tests and browser scripts. Tests use isolated fixtures, never production homeowner/lead writes. Source ZIPs are not signed IPA/APK files. Native compilation, physical iPhone/Android GPS, production task delivery, and App Store/TestFlight upload must be verified on the Mac/devices after deployment. Existing iOS dictation plugin and Android integration are retained from v14.8.

## iPhone simulator

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.9-ios.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.9-ios" &&
bash scripts/mobile/install-ios.sh simulator
```

For TestFlight preparation, use the same folder and `bash scripts/mobile/install-ios.sh xcode`, then archive/upload with the existing development team. This package is version 14.9, build 149; check that build number has not already been uploaded.

## Android

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.9-android.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.9-android" &&
bash scripts/mobile/install-android.sh
```

Installers copy .env.local from the newest working Downloads folder if available. Keep that file; no service-account secrets belong in it. In Android Studio select your phone and Run. Both ZIPs contain production web assets, but the installers rebuild from the source/configuration on your Mac.
