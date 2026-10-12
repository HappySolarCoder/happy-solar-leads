# v14.5 shared field fixes — verification report

| Check | Result | Evidence / limit |
| --- | --- | --- |
| Shared mobile unit suite | PASS | 107 tests, including personal scope, history preservation, reschedule protection and resumable boundary removal |
| NH / NI / CSM row | PASS | Three unique controls, same row, minimum 44px targets at 393px iPhone and 360px Android viewports |
| Own follow-ups for all roles | PASS | Actual provider/page tests for admin, manager and setter exclude another scheduler's reminders |
| Bulk removal | PASS | Select all across 55 records with 50-row pagination; cancel writes nothing; offline and failed saves preserve selection |
| Concurrent edits | PASS | One rescheduled record preserved while 54 selected reminders are cleared; only date/time fields written |
| Cleanup survives reload | PASS | Page reload reflects confirmed removal; other reps' reminders and pin data retained |
| Progress viewport | PASS | Content ends above tabs; no large outside footer; last action fully reachable above navigation with simulated platform insets |
| Delete all territories | PASS | Old-server fixture rejects unsupported actions; client uses `archive`, stops after failure, retains four remaining boundaries, retries same operation ID and preserves other user's territory |
| Existing reporting contract | PASS | Seven common dispositions, typed timestamps, uid/name/GPS, unchanged ownership, original-time offline sync, safe replay and Scheduling Manager payload/order in isolated fixtures |
| Startup/data recovery | PASS | Existing browser fixture checks for one profile read, no duplicate Today fetch, personal listener scope, error recovery and healthy reconnect behavior |
| Production static build / TypeScript | PASS | Shared static export completed for version 14.5/build 145 |
| Android/iOS assets and Capacitor sync | PASS | Both native bundles verified; identical release manifests; generated Android density sizes checked |
| React / visual review | PASS | Inspected both platform viewport screenshots; bounded follow-up rows, accessible selection and confirmation, derived personal scope, existing handlers reused |
| Native Xcode / Gradle compilation | NOT RUN | Linux environment has no Xcode or configured Android SDK; installers compile on user's Mac |
| Real iPhone / Android production acceptance | NOT RUN | User's simulator and physical phone testing required; no production mutations performed |
| Live Firestore permissions / reporting dashboard | NOT RUN | Existing deployed rules not modified; production readback/reporting proof requires designated real-device tests |

## Scope and safety

The iOS transport repair from v14.4 is unchanged. No new disposition IDs or collections, no lead deletion, no schema/index/rules deployment, no scheduling endpoint/payload changes and no Vercel deployment are included. Bulk follow-up cleanup uses only existing schedule fields in `leads`. It is an explicit online action, separate from the offline knock outbox, and does not add a knock/history entry or change claim/assignment fields.

Reminder ownership uses `goBackScheduledBy` first; missing legacy scheduler metadata falls back to claim, then assignment. This is a mobile list filter and a transaction precondition, not a substitute for Firestore security rules. Other admin views retain their existing access.

The supplied territory screenshot explicitly reports `Unknown territory action.` The source was sending `archive-many`; the new client instead submits the already implemented single-boundary `archive` action sequentially, with the captured version and an idempotency request ID. Existing server authorization/version checks remain in charge. No backend deployment is required by this client change. Live production deletion was not performed to prove it.

## Build repair

The shared production export passed, but the old Android asset command initially failed loading the legacy Sharp binary nested inside `@capacitor/assets`. A new Android generator uses the already pinned root Sharp runtime, matching the existing iPhone generator. Asset generation and both Capacitor syncs then passed. Dependencies and lockfile did not change. Android adaptive layers follow the documented 108dp layer / 66dp safe area; the approved SVG mark fits that area. Reference checked October 12 UTC: https://developer.android.com/develop/ui/compose/system/icon_design_adaptive

The release does not resolve the previous 42 dependency advisories and does not claim a new dependency audit. Admin lead loading remains unbounded, as documented in v14.4; none of these changes introduces another lead listener or background read loop.

## Test provenance

UI tests run the actual shared Next pages in Chromium with synthetic Firebase/API responses and simulated native safe areas. This verifies layout and interaction, not WebKit or Android hardware behavior. Native APIs, Firebase permissions, real GPS and Scheduling Manager delivery still need the device checks in FIELD-V14.5.md. The full supplied screenshots and logs are not uploaded to GitHub; only code, test scripts and sanitized verification results are included.
