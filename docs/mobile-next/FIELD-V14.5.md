# Raydar v14.5 / build 145 — Android and iPhone

Both downloads contain the same source revision and all four shared fixes. They extract into separate folders so you can test each platform independently. They are source/install packages, not signed APK/IPA files: Android Studio or Xcode compiles the native app on your Mac. The successful v14.4 iPhone authentication/Firestore transport configuration is retained.

## Changes

1. **Quick Actions:** NH, NI and CSM are three separate buttons in one row. The existing NH save, NI objection form and Scheduling Manager form are used. Those actions are not duplicated in the secondary grid. GB and the other dispositions remain available below.
2. **Personal follow-ups and cleanup:** every role, including admin/manager, sees its own reminders. `goBackScheduledBy` identifies the reminder owner; older records without that field fall back to `claimedBy`, then `assignedTo`. Today follow-up counts use the same scope. Nearby return reminders use the same ownership check.
3. **Progress layout:** the insights action is inside the page's scroll area. The bottom tabs remain at the bottom safe area and all progress content scrolls above them.
4. **Delete all territories:** uses the deployed `archive` action for each selected user's boundary, instead of the rejected `archive-many` action. Progress is shown after each success; failures retain the remaining boundaries for retry. An uncertain acknowledgement reuses the operation ID within the current page. No lead records are written by this operation.

The Android asset build also now uses the same pinned Sharp runtime as iPhone, avoiding the old nested Sharp install-script dependency that failed during clean-build verification. Both platforms use the approved Signal R logo and current release number.

## iPhone Simulator installation

Save `raydar-v14.5-ios.zip` in Downloads, then run:

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.5-ios.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.5-ios" &&
bash scripts/mobile/install-ios.sh simulator &&
npm run mobile:ios:location -- rochester &&
npm run mobile:ios:debug
```

This updates the existing simulator app without uninstalling it. Open Today, Knock, Follow-ups and Progress. Debug logs are saved in a new Desktop folder; press Control+C when finished.

To relaunch with debugging later:

```bash
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.5-ios" &&
npm run mobile:ios:debug
```

To prepare a physical iPhone/TestFlight build, run `bash scripts/mobile/install-ios.sh xcode` in that folder. The signing and TestFlight flow in IPHONE-V14.3.md remains applicable with version **14.5**, build **145**, and this new folder.

## Android installation

Save `raydar-v14.5-android.zip` in Downloads, then run:

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.5-android.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.5-android" &&
bash scripts/mobile/install-android.sh
```

Android Studio opens the updated native project. Wait for Gradle sync, select your connected Samsung phone or an Android emulator in the device selector, and press the green Run button. Keep the same application ID and signing setup so it updates in place. Do not uninstall while knocks are unsynced.

To reopen the project later without rebuilding screens:

```bash
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.5-android" &&
npx --no-install cap open android
```

Both installers automatically copy `.env.local` from the other v14.5 folder or a previous working download, including v14.4. Production remains `https://happy-solar-leads.vercel.app` and Firebase project `gen-lang-client-0395385938`, default database. No Firebase rules/index changes or Vercel deployment are needed for these changes.

## Bulk follow-up cleanup

Open Follow-ups → choose a filter or search → **Select to clean up** → select individual reminders or **Select all** → **Remove** → confirm. Select all includes every matching record across pages, not just the 50 displayed rows. Changing the search or filter clears selection to avoid hidden selections.

Cleanup clears only `goBackScheduledDate` and `goBackScheduledTime`. The lead itself, status, disposition timestamp/history, ownership, GPS, notes, go-back notes, scheduler attribution and appointments remain. Scheduling a new go-back makes the reminder appear again. Removal also takes effect on other devices through the existing lead listener, and the web go-back list excludes reminders with no scheduled date.

Cleanup requires connectivity and synced selected pins. It rechecks the signed-in uid and each current reminder in transactions of at most 50 leads. Rescheduled, reassigned or newly dispositioned records are skipped. Partial success is shown accurately and the remaining selection can be retried. No background polling or collection scans are added. Explicit cleanup uses normal Firestore transaction reads and writes for the selected records; it is not a zero-cost operation.

## Verification and device test

See `VERIFICATION-V14.5.json`, `REVIEW-V14.5.md`, and `CHANGED-FILES-V14.5.txt` for results and source changes. No production leads, territories or scheduling requests were changed during tests.

On each actual platform, verify the three-button row and existing NI/CSM forms; remove a designated test follow-up and confirm its pin/history remains; scroll Progress to the insights action and back; and remove designated test boundaries for a test user. Actual production actions are real. The automated checks use fictional data and cannot certify deployed permissions or physical-device behavior.
