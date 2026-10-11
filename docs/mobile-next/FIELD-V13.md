# Raydar mobile v13 — latest updates repackaged

This is the latest v12.7 code repackaged as v13 at your request. Functional behavior is unchanged. The archive name, app version display, Android/iOS version metadata, installation guide, and installer configuration lookup have been updated.

Included updates:

- Smaller, disposition-colored knock dots at neighborhood zoom levels, with detailed pins when zoomed closer.
- Homeowner coordinate-cache refresh from v12.5 for the corrected locations.
- Direct Firestore disposition saves, original knock timestamps, offline retry, and a visible unsynced count from v12.6.
- Removal of the Before you knock section from pin details.
- Quick Actions labeled NH, NI, GB, and CSM.

## Install on the Mac mini

Save `raydar-v13.zip` in Downloads, then paste this entire block into Terminal:

```bash
ditto -x -k "$HOME/Downloads/raydar-v13.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v13" &&
bash scripts/mobile/install-android.sh
```

The installer reuses an existing `.env.local` in this folder or looks for one in the standard Downloads folders for v12.7 and earlier releases. It installs dependencies, checks backend availability, builds the mobile app, syncs Android, and opens Android Studio. Select the connected phone or an installed Android emulator and press Run. This archive contains source for a local build, not a prebuilt APK. The Mac needs enough free storage for dependencies, build output, and any emulator image.

Android versionCode: 130. Android versionName: 13.0. iOS build: 130. iOS marketing version: 13.0. The visible app label is v13.

## Verification and limits

This version-only package receives shell syntax, release metadata, source-diff, and archive integrity checks. It inherits the production export validation from v12.7 and the isolated reporting/offline tests from v12.6. Physical Android/iPhone testing and live Firestore/reporting verification are still outstanding, as documented in FIELD-V12.6.md. Repackaging does not deploy a website/backend or modify production data, rules, or indexes.

Files changed from v12.7:

- MOBILE-APP.md
- android/app/build.gradle
- app/mobile/more/page.tsx
- docs/mobile-next/FIELD-V13.md
- ios/App/App.xcodeproj/project.pbxproj
- scripts/mobile/install-android.sh
