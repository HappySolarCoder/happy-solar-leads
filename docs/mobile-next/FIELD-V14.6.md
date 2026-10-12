# Raydar v14.6 — Android and iPhone testing

Version 14.6, build 146. Both packages contain the same shared source. These are source/install ZIPs, not signed APK or IPA files. The installers build the native app on your Mac. No App Store, TestFlight, website, or Firebase deployment is performed by these commands.

## Required server companion

The existing company backend enforces the old territory limits. Installing the mobile ZIP alone does not remove those server limits. The server companion adds paged previews and resumable assignments. Until that companion is deployed, the app displays a server-update notice, retains existing territory tools, and refuses to present a partial large-area preview as complete. Map, Focus, filters, drawing, and location improvements can be tested immediately.

The companion is prepared separately in `raydar-v14.6-server-companion.zip`. Its `SERVER-UPDATE.md` provides the exact scope and validation steps. It has NOT been deployed. The tests described in REVIEW-V14.6.md exercised the real updated handlers against synthetic data.

## iPhone simulator

Save `raydar-v14.6-ios.zip` in Downloads, then paste into Terminal:

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.6-ios.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.6-ios" &&
bash scripts/mobile/install-ios.sh simulator &&
npm run mobile:ios:location -- rochester &&
npm run mobile:ios:debug
```

The installer imports your previous `.env.local` when available. It uses the production Firebase web-app configuration and `https://happy-solar-leads.vercel.app`. The default Firebase database remains `(default)`.

Press Control+C to stop logging. Logs are saved on your Desktop. Simulator GPS is simulated: the Rochester command supplies its starting position. On a physical phone the app uses that phone’s location permission and GPS.

## Android emulator or phone

Save `raydar-v14.6-android.zip` in Downloads, then paste separately:

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.6-android.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.6-android" &&
bash scripts/mobile/install-android.sh
```

When Android Studio opens, choose an emulator or connected phone and click Run. In an emulator, use Extended controls → Location to set a test position. Check the app shows v14.6/build 146.

## Test checklist — both platforms

1. Open Knock as your admin account, then a regular account. With GPS permission granted, the map should center near the current location at street/roof level. Pan elsewhere: new GPS fixes must not snap it back. Background and reopen: it should center on a fresh location fix. The locate button must work repeatedly, even if GPS coordinates have not changed. Denied GPS must leave the map browsable.
2. Search is a compact magnifying-glass button. Tap it, search an address, select a result, and confirm the search panel closes and the map moves there.
3. Areas opens below its button. My territories shows only the signed-in user’s areas; Team territories shows the team overlay; Off removes it. Zoom to mine fits all the user’s assigned areas. With no assignments, show a clear message. Streets and lead pins remain usable beneath the translucent overlays.
4. Open Focus. Enter 60 doors and choose 3 appointments. Start: the card must show `0/60 doors` and `0/3 set` for a new session. Close/reopen the app and confirm both values persist. Edit to 100 doors and 5 appointments, keeping the session’s existing progress. Another signed-in user must not inherit this session. Sessions reset on a new local day, as before.
5. Filters contains Last 7 days, Last 30 days, This year, and All time, plus existing dispositions with multiple selection. Combine them, view the map, then reset. Solar Score filtering is gone. Recent-knock filters exclude unworked homeowner pins and apply to historical pins too. The date is the latest recorded knock, not an upload/sync date.
6. In Manage territories, filter to a team member and create a rectangle, corner polygon, or freehand outline. Lift near the start: automatic closure should tolerate imperfect finger placement. Drag numbered corners to correct a shape. A true crossing should request correction, not silently choose a different area.
7. With the server companion available, review and assign a territory containing more than 400 available pins. Review must finish scanning the area, and assignment progress should advance in batches. Simulate a network interruption: completed batches remain saved and Resume assignment continues the job. A newly knocked/claimed door must retain its history and owner.
8. Select an existing area, rename it, and transfer it to another rep. When filtering by rep, the page follows the new assignee after transfer so the saved area remains visible. Transfers move only that territory’s still-unworked assigned pins.
9. Delete a single territory, then use Delete all territories for a selected user. Cancel first and verify nothing changes. Confirm: only that user’s boundaries are removed. A failed item stays available for review/retry; successfully removed areas stay removed. Door history, notes, outcomes, and appointments are preserved.
10. Recheck v14.5: NH / NI / CSM quick actions remain one row; Follow-ups stays personal with bulk cleanup; Progress content remains above the bottom navigation.

The installed builds connect to live company data. Any real knock, assignment, reminder removal, or territory deletion you confirm is a real change. The automated checks use synthetic data and make no production writes.
