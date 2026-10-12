# Raydar v14.7 — local test release

Version 14.7, build 147. Separate iPhone and Android source/install ZIPs, with the same shared changes. These are not signed APK/IPA files. Nothing has been deployed, pushed to GitHub, or uploaded to TestFlight.

## What changed

1. Territory drawing: small draggable handles without visible corner numbers. Keep automatic shape closure and correction by dragging.
2. Large territories: current app always uses paged review and resumable assignments. The server companion must be applied to the API before large assignments work against the company backend. Missing support now explains the service-update dependency instead of telling users to choose a neighborhood. No pin-count or geographic-size cap applies to the paged path; permissions, overlap and valid-boundary checks remain.
3. iPhone dictation: a local Capacitor speech plugin using Apple's Speech and AVAudioEngine frameworks, registered through a custom bridge controller. Requests microphone/speech access when tapped, presents visible listening and recognized text, and provides Done/Cancel. Cancel, app backgrounding and panel unmount stop capture. No audio files are stored by Raydar. When on-device recognition is unavailable Apple may process speech. Android's existing dictation remains unchanged.
4. Knock top bar: consistent 44px controls, padding, Doors counter and a circular initials button opening account/tools. GPS recenter moves to the map's lower right above Focus. The Raydar R appears on wider screens only when space allows.
5. Quiet saving: no normal saving/syncing banners or technical success messages. Local durable saves update pins immediately. Confirmed knocks remain visible during a delayed live snapshot. A failed save or a change unconfirmed for 30 seconds exposes recovery; pending actions are never discarded by hiding the normal indicator.
6. House-level pins: 50% larger visual dimensions from zoom 17 onward for both worked and unworked pins. Zoomed-out density stays unchanged; disposition colors/icons and tap targets are preserved.

## iPhone simulator

Save raydar-v14.7-ios.zip in Downloads and paste:

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.7-ios.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.7-ios" &&
bash scripts/mobile/install-ios.sh simulator &&
npm run mobile:ios:location -- rochester &&
npm run mobile:ios:debug
```

Control+C ends logging. This preserves the existing app identity; do not uninstall to update if any unsent actions need recovery. The installer finds your previous working configuration. Xcode 26+ and Node 22+ are required by the existing project.

To open the same project for a physical iPhone build instead, run `bash scripts/mobile/install-ios.sh xcode`, select your development team and connected iPhone, and Run. Do not archive/upload to TestFlight yet.

## Android emulator or phone

Save raydar-v14.7-android.zip in Downloads, then paste separately:

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.7-android.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.7-android" &&
bash scripts/mobile/install-android.sh
```

In Android Studio, select your emulator or connected Samsung and click Run. Keep the app installed for an in-place update. Confirm v14.7/build 147.

## Test this round

- Draw by finger; confirm there are no visible numbers. Drag a corner and review. With the server companion deployed, assign more than 400 pins. Without it, confirm the service-update message preserves the drawing. Review/create/rename/transfer/delete are covered by isolated handler tests; live operations still require the server update.
- On iPhone, Dictate notes should prompt for the two permissions the first time, listen, show words, and append them to existing notes on Done. Review and save notes. Cancel should leave the draft unchanged. Test permission denied, empty speech, backgrounding and a second dictation. Simulator microphone behavior does not establish physical-iPhone reliability.
- On Android, repeat the working dictation flow to catch regressions.
- On Knock, inspect all controls at ordinary and larger font sizes. Open account from initials. Pan elsewhere, then tap GPS: recenter at street/roof level. Check GPS stays visible with Focus and a return reminder showing.
- Select NH and other dispositions, immediately close the homeowner panel: the pin must show the new color/status without a refresh or any routine save banner. Reopen the door and verify its last result. Confirm one known test knock in company reporting before team rollout.
- Test offline: a knock must survive closing/reopening the app; prolonged unconfirmed work must expose recovery; reconnect and verify it reaches the database once with the original time. Do not uninstall/clear storage while work needs recovery.
- At house zoom, verify last-result colors/icons are easier to distinguish. Zoom out and check density stays usable.

## Remaining native acceptance

This Linux environment cannot run Xcode or the physical iPhone microphone. Native iOS compilation, permission dialogs, speech capture and device layout must be checked on your Mac/iPhone before TestFlight. Browser fixture checks are not native-device proof. Installed apps still connect to live company data, so actions you confirm there are real.

## Server companion

Give your bot `raydar-v14.7-server-companion.zip`; its SERVER-UPDATE.md describes the required files and test steps. It is prepared, not deployed. The app's cosmetic, pin-size, saving and dictation changes do not depend on this territory update.
