# Raydar mobile v12.7 — simpler pin details and quick actions

Removed the entire **Before you knock** card from pin details and the mobile preview, including its duplicate last-conversation/next-action/outcome summary and suggested-note chips. The regular homeowner information, dispositions, notes/dictation, appointment outcome, go-back schedule, and history remain in their existing sections. No lead data is deleted.

Quick Actions now show **NH** (Not Home), **NI** (Not Interested), **GB** (Go Back), and **CSM** (Call Scheduling Manager). Full names remain in the accessible labels/tooltips and detailed forms. The stored disposition IDs, history labels, and scheduling workflow are unchanged.

This release builds on v12.6. The smaller map dots, direct Firestore saves, offline queue and visible unsynced count are included. The live-device/reporting limitations documented in FIELD-V12.6.md remain applicable; this small UI release does not claim new live verification or change production data, rules, indexes or websites.

Download raydar-v12.7.zip into Downloads on the Mac mini, then paste:

```bash
ditto -x -k "$HOME/Downloads/raydar-v12.7.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v12.7" &&
bash scripts/mobile/install-android.sh
```

The installer can copy the working .env.local from v12.6 or an earlier downloaded version. In Android Studio, select the connected phone and press Run. Android versionCode is 127/versionName 12.7; iOS build is 127/version 12.7. The archive is source for your local build, not a prebuilt APK.

Validation: production mobile export and TypeScript check; removal checked in app source and generated output. No new tests were added for this UI-only removal. Existing v12.6 validation evidence remains in its own versioned report.

Changed files relative to v12.6:

- MOBILE-APP.md
- android/app/build.gradle
- app/components/DoorstepMemory.tsx (deleted)
- app/components/LeadDetail.tsx
- app/mobile/more/page.tsx
- app/mobile/preview/page.tsx
- docs/mobile-next/FIELD-V12.7.md
- ios/App/App.xcodeproj/project.pbxproj
- scripts/mobile/install-android.sh
- scripts/mobile/check-reporting-v126.mjs (existing selectors updated for the accessible labels)
