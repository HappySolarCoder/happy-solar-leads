# Raydar mobile v12.6 — reporting contract and compact neighborhood pins

This is a local mobile source release, not a Vercel deployment or a prebuilt APK. Android versionCode 126/versionName 12.6; iOS build 126/version 12.6. Installing over Raydar Next keeps its existing app identity.

**Release status: code and isolated tests pass; live acceptance is incomplete.** No real rep account or physical iPhone/Android phone is accessible in this session. No real knock, scheduling webhook, Firestore mutation, rule/index change, homeowner write, bulk reread, or backfill was performed. Existing production websites were not deployed or changed.

## Pass/fail against the requested checks

“PASS — isolated” means verified in source, the production export, or synthetic tests. It does not mean a physical phone wrote to production. “FAIL — unverified” means the requested proof is still missing, not necessarily that the implementation failed.

| Requested check | Result | Evidence and limits |
| --- | --- | --- |
| 1. Production API base | PASS — build | Real mobile build rejects anything except `https://happy-solar-leads.vercel.app`. Production export compiled using the supplied production config. |
| 1. Firebase project and database | PASS — build | Project `gen-lang-client-0395385938`; `getFirestore(app)` selects `(default)`. New-lead commits explicitly target `(default)`. Wrong-project builds fail before export. Real credentials/account access remain unverified. |
| 2. Existing disposition IDs in `leads/{id}.status` | PASS — isolated | Uses existing disposition definitions, never display labels as status IDs. Seven UI cases tested: Not Home, Interested, Appointment, Sale!, House for Sale, Not Interested, Go Back. Configured custom IDs remain supported. |
| 2. `dispositionedAt` as Timestamp at knock time | PASS — isolated | One action Date captured before waiting for GPS; survives IndexedDB/reload. Existing-lead writes use SDK Timestamp; create-only REST writes use Firestore's typed `timestampValue`, not a Firestore string field. |
| 2. History newest first, UID/name | PASS — isolated | The web stores the **display name** in `history.disposition` and the **ID** in `status`. Entry fields are exactly disposition/timestamp/userId/userName, with Firebase UID checked against the active rep. Latest history is index 0. No extra history metadata is introduced by new mobile knocks. |
| 2. GPS, objection and go-back fields | PASS — isolated | Same five GPS field names and web objection/go-back fields. GPS permission/proximity rules remain enforced. Roles allowed to save without GPS retain that existing behavior; missing GPS is not invented. |
| 2. Claim/unclaim and unchanged ownership on dispositions | PASS — isolated | Explicit actions still call claimLead/unclaimLead. Tested partial disposition updates omit ownership/assignment fields. Unclaim now serializes field deletion correctly and may release a claimed lead after disposition. A targeted get replaces a whole-lead-list lookup. Initial new manual leads are attributed to their creator, as before. |
| 2. No new knock collection | PASS — isolated | All captured actions sync to `leads/{id}`. The queue is device IndexedDB, not a Firestore collection. No client writes to homeowners or reporting copies. |
| 3. No native field API dependency | PASS — isolated | Native build forces capture off, never loads `/api/field-config`, and saves from LeadDetail via the direct Firestore worker. Actual Knock-page test recorded zero calls to field-work/config/recovery/mobile-user-management. Existing legacy knock/notes drafts can recover through the direct writer; unsupported legacy handoffs remain visibly blocked for review. |
| 3. `field_settings/v11` missing or capture=false in production | FAIL — unverified | Unauthenticated read returned 403 PERMISSION_DENIED; absence/off cannot be inferred. Native capture stays off regardless. An authorized read-only bot check is needed; no settings document was changed. |
| 4. Same Scheduling Manager endpoint/payload | PASS — isolated | Reads the existing `adminSettings/global` notificationWebhook/type. Exact web message/provider keys retained. Uses the current mobile rep, persists the lead first, then sends. Native Capacitor HTTP avoids browser CORS restrictions; transport is unit-tested. |
| 4. Scheduling request works on physical iPhone and Android | FAIL — unverified | Neither physical device was available. Mock transport/browser tests are not physical-device proof. No real scheduling message was sent. |
| 5. Offline time, durability, reconnect and count | PASS — isolated | Tested offline save, full page reload, automatic reconnect drain, unchanged original Timestamp, retained unsynced count, and a lost server acknowledgement followed by retry without another create/history entry. App retries while open, when resumed, and after reopening. It cannot run while the OS has terminated it. |
| 5. Offline behavior on physical phones | FAIL — unverified | Needs the airplane-mode/restart test below on Android and iPhone. Do not uninstall or clear app storage while the unsynced count is nonzero. |
| 6. Real rep, all common dispositions and appointment readback | FAIL — unverified | No real rep session/physical devices or approved test lead IDs are available. No production test actions were fabricated. |
| 6. Knocks appear in reporting metrics | FAIL | The exact supplied endpoint returned HTTP 404 **DEPLOYMENT_NOT_FOUND** on Oct 11, 2026 at 13:49 Arizona time. A working endpoint/access must be restored or supplied before rep counts can be checked; waiting for the hourly cache does not fix that response. |

Reporting endpoint checked with no credentials:
`https://happy-solar-reporting.vercel.app/api/metrics/raydar_doors_knocked?period=today&format=json`

The unavailable `/api/field-work` route also returned 404. Mobile knocking no longer depends on deploying it. Management tools that depend on separate undeployed routes still need their own backend work; this release does not claim those routes were installed.

## What changed in saving

LeadDetail creates a canonical partial lead update and saves it to the existing account-scoped IndexedDB outbox. Reps see a visible unsynced counter until Firestore confirms it. Retried writes preserve original knock time and actor. A transaction merges existing history and recognizes a replay by the same UID, timestamp and disposition. Older offline events enter history without replacing a newer server status/GPS.

New homeowner visits use a single authenticated Firestore create with `exists:false`. This matters because the repository's rep rules allow creating a manual lead but do not allow reading a nonexistent lead first. After an uncertain acknowledgement, an existing document is merged, not overwritten. Existing Firestore rules authorize all requests; no Admin SDK credentials ship in the app.

Legacy draft recovery preserves the stored time/UID/GPS. Old drafts that did not record a rep name use that rep's current profile name. Unsupported or unauthorized work remains visible and is not silently discarded. Optional old API-based reward hooks are not run by the native direct-save worker.

Sending information to Scheduling Manager does **not** automatically set an Appointment disposition: this matches the web workflow. Record the Appointment disposition when an appointment is actually set. Native requests are not auto-retried, since a timeout can occur after the scheduler already received the message.

## Map change from the screenshot

At neighborhood zoom, worked leads use small round dots in their existing disposition colors, matching the homeowner dots' footprint. They are centered on the coordinates, with no shield or floating warm-lead badge covering nearby roofs. Detailed 20px pins, including the Signal R on solar-rated warm leads, return at the closest zoom (19+). Selection retains a visible outline and 44px interaction area.

The visual issue had a second cause: Leaflet's `width:auto` CSS was overriding the HTML marker dimensions. A 7px configured dot measured about 26px in the real rendered page. Explicit CSS width and height now enforce the intended size. Browser verification measures the actual rendered dimensions, not just the source values. Satellite/map toggle and imagery providers are unchanged.

No homeowner query, cache version, 500-document viewport limit, index, or rules were changed by this release. The v12.5 corrected-coordinate cache migration remains included. Map styling adds no Firestore reads. Reliable existing-lead sync adds a targeted transaction read per saved update (plus possible retries and normal rule-dependent reads); it does not reread the homeowner dataset. This is not a promise of zero incremental cost.

## Local install on the Mac mini

Download `raydar-v12.6.zip` to Downloads, then paste **only** this block in Terminal:

```bash
ditto -x -k "$HOME/Downloads/raydar-v12.6.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v12.6" &&
bash scripts/mobile/install-android.sh
```

The installer copies `.env.local` from the newest available previous Raydar folder, starting with v12.5, installs locked dependencies, exports the production build, syncs Android, and opens Android Studio. Select the connected phone and press Run. Toolchain upgrade prompts are not required for this update. Do not use `npm audit fix --force` during this install.

For iOS on the same Mac after installation:

```bash
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v12.6" &&
npm run mobile:ios
```

## Complete the real-device acceptance check

Use one real signed-in rep account and deliberately selected test leads only. Verify the app's Workspace footer says v12.6. Use the same approved test lead IDs in the readback; do not scan all leads or homeowners. Use different test leads for each disposition if you want every tested outcome to remain current at index 0.

1. On each physical platform, record a Not Home, Interested, Appointment, Not Interested (with objection), Go Back (with date/time/notes), and the other common configured dispositions. Note lead IDs, rep UID and local action time. Confirm the unsynced count clears.
2. On an approved lead, enable airplane mode, record a knock, verify the count increases, close/reopen the app, restore connectivity and reopen/resume it. Confirm automatic sync and original action time. Record the ID/time for comparison.
3. Send one deliberate test Scheduling Manager request from each platform. Confirm the actual recipient received it with the right rep and homeowner details. Check for an existing received request before retrying a timed-out send.
4. Read just those lead documents. Assert `status`, true Firestore Timestamp type, newest history UID/name/time, GPS, objection and go-back fields. Confirm no ownership changes from dispositions. Compare with a deliberate web action on approved test leads.
5. Repair/confirm the supplied reporting URL, then check the rep's today metric after its normal cache refresh (up to about one hour), using the reporting service's configured day/timezone.

No live test was run here. The existing application may have unrelated presence/session behavior; the real-device tester should arrange the test environment so only authorized test-lead writes occur and should not run backfills, rule changes or user-management actions.

## Read-only prompt for the Firebase/reporting bot

> Inspect project gen-lang-client-0395385938, (default), read-only. Do not change rules, indexes, settings, users, homeowners, other collections or existing lead data. Read field_settings/v11 once and report whether it is missing or enabled.capture is exactly false; a permission error is not evidence of absence. For only the test lead IDs I provide, report status, Firestore type and value of dispositionedAt, dispositionHistory[0] fields, the five knock GPS fields, objection/go-back fields, and ownership/assignment values. Compare these with the rep UID, original action time and web baseline I provide. Do not scan collections. The supplied reporting metrics URL returned DEPLOYMENT_NOT_FOUND; identify the existing correct deployment/URL without deploying anything or modifying it. Once a working endpoint is known, report that rep's today count and cache time. Report PASS or FAIL for each check and do not infer phone/webhook delivery from database contents.

## Verification and files

`VERIFICATION-V12.6.json` contains machine-readable isolated-test and public-probe evidence. `CHANGED-FILES-V12.6.txt` lists every changed file against v12.5, including this release documentation. The archive contains source and native projects, excluding environment files, dependencies and generated test/build directories.
