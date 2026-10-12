# Raydar 14.10 (150) — tester pin feedback

Both platform packages use the same mobile screens and production Firebase/API configuration.

- Previously worked pins are twice their previous visual width at each zoom tier. Unworked and homeowner circles are unchanged. Past territory pins also double.
- The map groups loaded visits at the same normalized street address, including common suffixes, full postal addresses and nearby postal-town aliases. One pin uses the most recent visit. Grouping works when the homeowner layer is off. Different house numbers are not merged merely because they are nearby.
- Loaded homeowner records attach to the grouped door. Corrected homeowner coordinates position the map artwork without modifying saved lead coordinates.
- Disposition History appears below disposition controls, combines the grouped records, sorts newest first and expands to show older entries. History is display-only; writes still target the selected original lead and retain its ownership.
- iPhone and Android use a native DOM long-press handler. Hold a clear roof for about 0.7 seconds. Moving, pinching, ending or cancelling the gesture cancels the timer. The form opens immediately; address lookup runs in the background and does not replace typed fields.
- Mobile manual pins now use the existing durable direct-write queue, appear immediately, preserve knock time and collect GPS through the same deferred verification as other knocks. Native manual saves do not run legacy automatic reassignment or paid solar enrichment.
- Business card creator is linked from Field tools and Workspace, opening https://happy-solar-bloom-portal.vercel.app/business-card in the phone's browser.

## Data and cost

No new backend, rules, index or collection changes. No deduplication writes, homeowner writes, bulk re-reads or backfills. Existing viewport limits remain unchanged. The map groups only records it already has, so incomplete viewport results can still omit older visits until loaded normally.

Opening a grouped door can read its older summarized lead documents to show full history: at most eight initially, four concurrent, then another eight only when the user asks. A five-minute, 96-record memory cache avoids repeated history reads. Opening history does not scan Firestore for duplicates. Canonical lead histories are never rewritten with the display aggregate.

## Install on the Mac mini

iOS simulator:

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.10-ios.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.10-ios" &&
bash scripts/mobile/install-ios.sh simulator
```

To prepare an archive for TestFlight, use `bash scripts/mobile/install-ios.sh xcode` instead. In Xcode select your team and Any iOS Device, then Product → Archive → Distribute App → App Store Connect. Upload version 14.10, build 150, and add it to the testing group after processing.

Android:

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.10-android.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.10-android" &&
bash scripts/mobile/install-android.sh
```

Installers reuse configuration from your existing working Downloads folders. ZIPs contain source and configured web assets, not a signed IPA/APK. Signing and native compilation require your Mac/Android tooling.

## Verification limits

See VERIFY-V14.10.md for executed checks. Exported browser checks use fictional records and mobile screen sizes, not physical iPhone/Android devices. Confirm long-press, pin visibility and the external business-card page with your TestFlight and Android testers before wider rollout.
