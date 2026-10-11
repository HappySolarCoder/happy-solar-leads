# Raydar v12.4 — homeowner circles and knock controls

Homeowner records now use the logo's slate blue (`#476E88`) in a simple circle. Owner and suspected-renter records share that circle; the estimate remains visible in the details. The marker box grows from 7 px at neighborhood zoom to 9 px at street zoom, 14 px at zoom 18, and 18 px at the closest supported zoom (19). Selection adds a yellow ring. The visible circle is smaller than its box, and the existing 24 px hit radius is preserved.

The requested roughly 15% roof coverage is a visual target, not a calculation: these records have coordinates, not roof footprints. Real roof size, imagery alignment, and latitude vary. Close zoom is deliberately more legible than v12.3 while most of the roof stays visible.

## Knock a home

Tapping an unvisited homeowner circle opens the existing LeadDetail panel with the homeowner's name and estimated occupancy, the same configured dispositions, notes/dictation, objections, return visits, photos, and scheduling manager form. Homeowner information is compact, the duplicate name is removed, and an empty conversation-history card does not push the first visit's actions offscreen. Scheduling Manager is available directly in the mobile quick actions, even when optional field tools are off.

Opening/closing the panel performs no lead creation and never writes to `homeowners`. The first explicit save creates an ordinary `manually-added` lead owned by the signed-in FMA, with the selected outcome/history and a homeowner-record snapshot. Subsequent saves update that same lead. An already loaded matching visit opens normally, preserving its existing ownership and history. The normal worked/outcome marker replaces the circle. Saved homeowner information remains available when reopening the visit or turning the homeowner layer off.

The scheduling flow remains Send Info → Call Scheduling Manager. Saving/sending from a new home persists its lead information first; simply opening the form does not create a lead. Property ZIP is left blank because the import's mailing ZIP is not necessarily the property's ZIP. Confirm the ZIP and contact information before sending.

Save failures retain the draft ID for retry. Objection and Go Back forms show errors and retain their inputs. Save buttons wait for the result rather than closing prematurely. GPS/proximity requirements continue to apply; the new-home special outcomes also enforce them.

A brand-new home requires a connection for its first save. Offline attempts explicitly say to reconnect and retry; keep the panel open to retain unsaved inputs. This is not a new durable offline homeowner outbox. Once created, the existing field queue is used when capture is enabled. That optional queue still requires the existing field backend/feature configuration; this release does not activate it.

## Cost and deployment

- No new homeowner queries, subscriptions, geocoding, solar enrichment, or paid service. The 30-day cache, 500-document query cap, and existing per-view budgets remain unchanged.
- New lead records are created only for homes where someone explicitly saves work, not for all imported records. Normal saved-work Firestore writes, listener reads, and storage still apply. Enabling optional field capture uses its existing event-write flow (after preparing a new lead).
- The imported `homeowners` collection stays read-only. No Firebase rules/index/backend change is required beyond already functioning homeowner read access and the existing manual-lead create/update permissions. Live rules were not deployed or changed for this release.
- This is a source ZIP from the separate local mobile branch; GitHub publication was blocked by automatic approval review and was not completed. The production website was not deployed or changed. Do not merge the mobile branch into the web production branch.

## Install on the Mac mini

Download `raydar-v12.4.zip` from the chat into Downloads, then paste the whole block into Terminal:

```bash
ditto -x -k "$HOME/Downloads/raydar-v12.4.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v12.4" &&
bash scripts/mobile/install-android.sh
```

The installer reuses `.env.local` from a previous Raydar download when needed, installs dependencies, builds the real mobile bundle, and opens Android Studio. Choose the connected Galaxy S25 and click Run. Do not install the fictional test export. Android versionCode 124/versionName 12.4; iOS build 124/version 12.4. This ZIP contains source, not a prebuilt APK.

## Verification

- 81 mobile/server tests passed, including first outcome creation, no writes on selection, partial note updates, stable retry ID, simultaneous-save guard, account/offline checks, and unchanged homeowner-query sequences.
- Static mobile export and TypeScript build passed. New homeowner modules pass focused lint; edited legacy components retain 23 pre-existing lint errors with no new lint errors in the comparison.
- Browser checks on the actual Knock page use fictional Firebase/auth fixtures, with all remote services blocked or mocked. They cover homeowner selection, one first outcome write, notes, worked-marker replacement, reopening, failed Go Back retry, offline messaging/retry, scheduling Send/Call, and narrow/tablet widths.
- Canvas/list/cache regression checks passed: one canvas, existing worked-pin selection, larger invisible tap areas, close-neighbor selection, keyboard selection, bounded lists, reload/offline zero repeated cache reads, and zoom-out hiding.
- The same isolated 2,000-marker render benchmark at 4× CPU throttling measured median 11.1 ms (v12.3 measured 11.6 ms). Pan/zoom pauses produced zero canvas redraws during movement. This measures canvas drawing, not app FPS or physical-phone performance.

No live homeowner/lead data was changed by tests. Native compilation, the installed Galaxy S25, live production permissions, and actual satellite/roof alignment still need a device check.

Reproduce the targeted checks:

```bash
npm run mobile:test
node scripts/mobile/check-export.mjs --audit
node scripts/mobile/check-homeowner-knocking-v124.mjs
node scripts/mobile/check-pin-density-v123.mjs
node scripts/mobile/check-homeowner-render-performance.mjs
MOBILE_EXPORT_DIR=/tmp/raydar-ui-audit-out node scripts/mobile/check-homeowners-v12.mjs
```

Browser scripts expect `/tmp/raydar-browser/chromium` (or the configurable path where supported). The audit build substitutes fictional data modules; the normal Android installer never includes those substitutes.
