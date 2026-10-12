# Raydar v14.8 — iPhone and Android

Version 14.8 / build 148. Both source ZIPs contain the same shared app and fixes. These are source/install packages, not signed IPA/APK files. The backend companion is required before team rollout; see SERVER-V14.8.md. No TestFlight upload or production deployment has been performed here.

## Included changes

- Fix duplicate Focus/reminder React identities. The failure reproduced 17 Focus controls after updates; the fixed screen keeps one. GPS listeners stop when leaving the map.
- Reuse the iOS storyboard bridge rather than starting another WebView. Both iOS launch paths now reach the controller that registers RaydarDictation. Native speech/microphone acceptance remains required.
- Separate personal activity from worked-map viewport loading; remove the admin's company-wide live-lead subscription from the mobile screen. Cache and deduplicate requests across tab navigation. A selected summary fetches full door details before editing notes/photos.
- Apply successful knocks, notes, scheduling contact edits, claim/unclaim and follow-up cleanup to shared local state immediately, without requerying the whole account after each save. Keep direct Firestore writes and the existing scheduling webhook.
- Standard reps see worked/homeowner pins within their assigned territory, with viewport-intersected homeowner loading. Admin/manager can browse all neighborhoods. Keep corrected homeowner coordinates, existing caches and query limits; no backfills or homeowner writes.
- Lower homeowner memory retention and let dense cached ranges progress without treating a capped result as complete.
- GPS retry stays actionable after denial/unavailability and sits at the map's lower right level with centered Focus. Repeated Zoom to mine uses loaded territory state. Map controls fit narrow screens.
- Drawn boundaries follow dragged corners exactly, with no false simplified crossing; actual crossing validation remains. No automatic geometry repair/reshaping was added.
- Preserve v14.7 paged/resumable territory assignment. The backend companion must be deployed to enable it against production.
- Remove routine cached/background-refresh notices. Failed or prolonged unconfirmed saves still show a visible count/recovery; the outbox is not cleared.
- Add Account → Send voice feedback: record, review, send, durable retry. Admins can review/download recordings for later transcription. No paid AI. Recording stops on backgrounding or closing the panel.
- Add a recoverable mobile error screen. Retain NH/NI/CSM quick buttons, personal bulk follow-up cleanup, Progress safe-area layout and territory deletion that preserves lead history.

## Install on your Mac mini

Save both ZIPs in Downloads. The installers copy .env.local from a previous working Raydar Downloads folder when available. They rebuild web assets and sync the native project; do not open an older project from Xcode's recent list. Keep the same installed app identity to retain pending actions.

### iPhone simulator

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.8-ios.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.8-ios" &&
bash scripts/mobile/install-ios.sh simulator &&
npm run mobile:ios:location -- rochester &&
npm run mobile:ios:debug
```

Control+C stops logging. Logs go to the Desktop. Simulated location allows map testing but does not prove physical GPS/compass accuracy or battery/heat behavior.

### Android

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.8-android.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.8-android" &&
bash scripts/mobile/install-android.sh
```

Select your connected Samsung or emulator in Android Studio and click Run. Confirm 14.8/148 on both platforms.

### Prepare the iPhone TestFlight upload

After backend acceptance and local testing:

```bash
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.8-ios" &&
bash scripts/mobile/install-ios.sh xcode
```

In Xcode select target App → Signing & Capabilities → your existing paid development team. Keep bundle ID com.happyslr.raydar.next and verify version 14.8, build 148. Choose a generic iOS device destination (not the simulator), then Product → Archive. In Organizer select this archive → Distribute App → App Store Connect → Upload. Use the existing Raydar Canvassing App Store Connect record. Once processing completes, select build 148 for the existing TestFlight tester group; complete any requested compliance/beta-review information. Testers then open TestFlight and tap Update. Do not choose an internal-only upload if your group uses external TestFlight testers. No public App Store release is required for this test distribution.

Apple references: https://developer.apple.com/tutorials/develop-in-swift/test-your-beta-app and https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/

## Required device acceptance

Use an identified test rep and approved test leads. Production-configured apps write real data when you save. Test iPhone SE and a typical Samsung for 20–30 minutes: repeated tabs, map pan/zoom, GPS deny/retry, background/resume and opening different doors. Check heat, responsiveness and absence of a white screen. Browser heap measurements are not device thermal proof.

On iPhone: Dictate notes → allow microphone/speech → speak → Done → review/save. Confirm text appends to existing notes; Cancel/backgrounding must stop recording without changing notes. Repeat with permission denied. On both platforms: record beta feedback, review/play, send, simulate disconnect, retry and confirm one admin-accessible recording.

Log approved common dispositions online and offline, then read the lead documents back: status IDs, Firestore Timestamp dispositionedAt/history, original time, signed-in uid/name, GPS and unchanged ownership. Confirm the scheduling webhook receives a request from each physical platform and that reporting counts the test knocks after its cache refresh. No physical-device or production-write acceptance has been performed in this environment.

## Source and handoff

The mobile source is published on a separate versioned GitHub branch. Give your bot the backend companion ZIP for the live API update and the full source ZIP/branch for app development. Do not merge the entire mobile branch into the website's production main branch. REVIEW-V14.8.md lists verification results and limitations; CHANGED-FILES-V14.8.txt lists files changed since v14.7.
