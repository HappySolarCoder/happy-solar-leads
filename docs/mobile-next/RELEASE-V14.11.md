# Raydar 14.11 (151) — pin stability and manual-lead form

Based on v14.10. Both packages use the existing production Firebase project and API.

- One displayed pin per loaded house, using its most recent known knock. Older personal, viewport, and saved-record snapshots no longer replace newer knock records. Timestamp conversion accepts serialized Firestore timestamps, and missing history timestamps are no longer treated as a new event.
- Newer history determines the visible disposition when the record's status is stale. House grouping is independent of page order and still works with homeowner pins off. Duplicate imported homeowner rows are collapsed for display. Existing lead records and their histories are not deduplicated or rewritten.
- Pins remain visible while another map area loads, while partial pages arrive, and if a refresh fails. A newer visit reuses the house's existing marker. Corrected rooftop anchors remain stable during homeowner refreshes. A completed response can still remove records that no longer exist in that view.
- Dense views offer **Load more pins**, continuing the existing cursor after the automatic two-page budget. Each tap can scan two more pages, up to 500 records per page; the retained record limit remains bounded at 6,000. Until loading is complete, the map can only choose the latest record it has received. Zoom closer if a dense view reaches the limit.
- Add New Lead now opens above the map, fits the visible viewport, and scrolls its fields independently. Save Lead and Cancel remain in the footer when the keyboard reduces the available height.
- Map loading/error actions accept taps. Customer classification no longer overrides a later knock's symbol; the appointment outcome badge remains independent.

No backend deployment, Firestore rule/index change, data migration, or change to the direct-write queue is required. Automated verification uses fictional records and blocks production traffic.

## Install on the Mac mini

Extract the downloaded ZIP, open Terminal in the extracted release folder, and run:

```bash
bash scripts/mobile/install-ios.sh simulator
```

For TestFlight preparation use `bash scripts/mobile/install-ios.sh xcode`, then archive and distribute in Xcode with your signing team. The release is version **14.11**, build **151**. The installer reuses your working `.env.local` from earlier downloaded releases, including v14.10.

For Android, open Terminal in the extracted Android release folder and run:

```bash
bash scripts/mobile/install-android.sh
```

ZIPs contain source and configured web assets, not signed IPA/APK files. Native compilation and signing still require the platform tools.

## Phone acceptance check

1. Open a street with past knocks; compare a house's pin with its newest history entry. Confirm one pin with homeowner pins both on and off.
2. Pan slightly, zoom out and back, and repeat on a weak connection. Existing in-scope pins should stay while loading; Retry pins should work after an error.
3. On a dense view, tap Load more pins and check that later records appear.
4. Hold a roof to add a manual pin. With the keyboard open, reach the final field and Save Lead on a small phone. Save once and confirm one new knock and one pin.

See VERIFY-V14.11.md for executed checks and limits. Physical iPhone/Android testing remains required before wider rollout.
