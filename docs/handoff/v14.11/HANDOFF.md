# Raydar / Grok project handoff

Happy Solar field app | Release 14.11 | Native build 151

Prepared October 16, 2026, America/Phoenix. Repository and endpoint checks were performed October 17, 2026 UTC. This is a technical and operational transfer of the existing project, not a new app release.

## Start from this release

The current mobile release is **v14.11, build 151**. It continues v14.10 and fixes latest-knock selection, duplicate house pins, disappearing pins during refresh, and the manual-lead form's inaccessible Save button. The iOS and Android ZIPs contain complete source and configured web assets. They are not signed IPA, APK, or AAB files.

The source is published in [HappySolarCoder/happy-solar-leads](https://github.com/HappySolarCoder/happy-solar-leads). Use the mobile release or handoff branch listed on page 3. The website's main branch is a separate deployment concern.

## What is established

- The release branch still matches the published v14.11 commit. Both delivered ZIPs passed integrity and version checks.
- The release's 146 automated tests passed in a serial run. Mobile-sized browser checks, production export, and Capacitor sync passed on October 15.
- Fresh unauthenticated checks found the three required API routes present and rejecting unauthenticated requests. This does not establish authenticated end-to-end correctness.

## What remains open

Physical iPhone/Android acceptance, signing, store upload, authenticated production data flows, live GHL synchronization, and Cloud Tasks territory completion have not been established by this handoff. Confirm these with the owner and approved test records.

## The three rules that protect continuity

1. Keep one displayed pin per loaded house, showing its newest known knock. Preserve every original visit/history record.
2. Preserve account-scoped unsynced work. Never clear app storage or uninstall as a routine fix while knocks or recordings are pending.
3. Keep mobile packaging and website/backend deployment separate. Uploading a mobile build does not deploy server routes.

Read `BOT-START-HERE.md` first, then this document. `RELEASE-MANIFEST.json` and `SHA256SUMS.txt` identify the supplied artifacts.

<!-- PAGE -->
# 01 / First 30 minutes

## Recommended takeover sequence

1. Read the release identity on page 3 and the verification limits in sections 15-16. Do not assume a successful build means a successful live deployment.
2. Clone the handoff branch into a fresh folder. Preserve any existing local work and working device configuration.
3. Obtain the existing public Firebase web-app configuration through the owner's secure configuration channel. Do not request private signing keys or service-account JSON in chat.
4. Run the serial test suite. Inspect the build scripts, then open the native project using the platform recipe.
5. Run the read-only backend probe. Use approved accounts/records for subsequent authenticated tests.
6. Report the exact source commit, version/build, environment, tests run, and remaining blockers before changing behavior.

```bash
git clone --branch codex/raydar-grok-handoff-v14-11 \
  https://github.com/HappySolarCoder/happy-solar-leads.git \
  raydar-grok
cd raydar-grok
npm ci
node --import tsx --test --test-concurrency=1 tests/mobile/*.test.ts
```

GitHub access must be available to the bot's own account/session. No access token is embedded in this package. Use the owner's normal GitHub authentication mechanism if cloning prompts for authentication.

## Transfer package contents

| Item | Purpose |
| --- | --- |
| Raydar-Grok-Handoff-v14.11.pdf | Human-readable operational and technical manual |
| HANDOFF.md | Same substantive content for an agent to read/search |
| BOT-START-HERE.md | Copy-ready takeover instruction and first actions |
| ACCEPTANCE-CHECKLIST.md | Device and integration test record |
| RELEASE-MANIFEST.json / SHA256SUMS.txt | Identity, hashes, environment names, current probe results |
| source/raydar-v14.11-source-with-handoff.zip | Full tracked source plus this handoff, without build caches or credentials |
| releases/raydar-v14.11-ios.zip | Original verified iOS release package |
| releases/raydar-v14.11-android.zip | Original verified Android release package |

The GitHub handoff branch contains the full rebuildable source, PDF, Markdown instructions, and manifest. The complete transfer ZIP also includes the two original platform packages with their prebuilt web assets.

<!-- PAGE -->
# 02 / Release identity and source of truth

| Identifier | Authoritative value |
| --- | --- |
| Repository | HappySolarCoder/happy-solar-leads |
| Mobile release branch | codex/raydar-mobile-v14-11-pin-stability |
| Documentation / takeover branch | codex/raydar-grok-handoff-v14-11 |
| App version / build | 14.11 / 151 |
| Native display name | Raydar Next |
| iOS bundle ID / Android applicationId | com.happyslr.raydar.next |
| Android namespace | com.happyslr.raydar (intentionally distinct from applicationId) |
| Production API origin | https://happy-solar-leads.vercel.app |
| Firebase project / database | gen-lang-client-0395385938 / (default) |
| Firebase auth domain | gen-lang-client-0395385938.firebaseapp.com |

## Pinned source identities

| Source object | SHA |
| --- | --- |
| GitHub release commit | 337461c2a4fd2a66d4c624be1da5c4959fa242a5 |
| Original local commit recorded in ZIPs | 04720636f9f37f73f98cacddd3b1b9974cc5388c |
| Identical complete source tree | e2080c9d3dd9c64932b8e3611c199b9f5d1adf8a |

These are different commit objects with the **same complete source tree**. The GitHub commit was created through the connected GitHub account after terminal authentication was unavailable.

The handoff adds documentation; it does not increment the app version or alter runtime code. The existing mobile branch was unchanged when compared with the pinned GitHub commit during this transfer.

## Resolve conflicting older notes

Follow executable configuration and the v14.11 release notes. Older `MOBILE-APP.md` / `MOBILE-NEXT.md` passages describe earlier designs: an old bundle ID, company-wide listeners, or no durable offline support. Current native identity is `.next`; personal/map loading is bounded; direct native knocks use the durable outbox. The current admin helper expects `FIREBASE_SERVICE_ACCOUNT`; the separate GHL helper expects `FIREBASE_SERVICE_ACCOUNT_JSON`. They are not interchangeable labels.

<!-- PAGE -->
# 03 / Product, users, and current scope

Raydar supports Happy Solar's door-to-door work: finding homes, recording visits, setting follow-ups, sending appointment requests, inspecting performance, and managing territory. Preserve the established slate-blue/yellow Signal R design and the mobile-first workflow.

| Area | Current responsibility |
| --- | --- |
| Today | Personal activity, pace, follow-ups, and entry to knocking |
| Knock | Leaflet map, homeowner layer, past visits, filters, manual pins, GPS, lead details |
| Follow-ups | Searchable go-back agenda and existing lead actions |
| Progress | Period-based personal activity metrics |
| Field tools / Workspace | Business-card link, recording/recovery tools, role-gated management links |
| Territories / Team map | Boundary tools, assignment progress, team/area overlays |

## Roles and scope

The typed roles are `setter`, `closer`, `manager`, and `admin`. FMA is the business role generally represented by setter workflows; do not create a new role string solely to match terminology. Check existing profile records and permission helpers before changing any role behavior.

Standard reps' map results are scoped to assigned territories. Admin/manager map browsing is bounded by the requested viewport. Personal API pages are tied to the authenticated UID. Inactive, deleted, pending-deletion, or unapproved accounts are rejected by the mobile-leads handler. UI filtering is not a substitute for server authorization or deployed Firestore rules.

## Included in v14.11

- Resolve older/newer snapshots by event time and prefer a full document on equal-version summary/full conflicts.
- Group loaded visits and duplicate homeowner rows into one displayed house pin, preserving raw records.
- Keep known pins during partial/failed refreshes; reuse a marker when the winning visit ID changes.
- Continue dense viewport pages with Load more pins.
- Place Add New Lead in a top-layer dialog with scrolling fields and a visible footer.

## Discussed but not built

Automatic walking-camera follow, two-finger map rotation/roof inspection, and a Radar-integrated business-card send/open-alert flow are future work. The current business-card feature opens Bloom in the browser. No tracking/alert backend or background push delivery for that concept was added.

<!-- PAGE -->
# 04 / Architecture and data flow

The app is Next.js/React packaged in Capacitor native containers. It is not a React Native rewrite and does not load a remote website through `server.url` or an iframe.

<!-- ARCHITECTURE -->

## Read path

The shared mobile session/provider resolves the signed-in user and role. `useLiveLeads` reads personal API pages and caches the result. `useViewportLeads` reads bounded map summaries. `useHomeowners` independently reads small geohash ranges from the read-only homeowner collection. The Knock page reconciles those records and passes them to Leaflet rendering.

## Write path

Native knock actions capture the actor, original action time, and intended patch, then persist an account-scoped draft in IndexedDB. GPS verification completes against that original action. The sync path commits eligible mutations to existing lead records and keeps failures recoverable. Acknowledged actions remain visible while other data sources catch up.

## Build boundary

`scripts/mobile/build.mjs` copies app/public source into `.mobile-build`, excludes `app/api`, performs a static export, and creates `out`. It sets `NEXT_PUBLIC_NATIVE_BUILD=1`. Capacitor copies that output into each native project. API routes continue to run on the existing HTTPS backend. The ordinary `npm run build` is the server/web build and is a different workflow.

## Transport boundary

`apiFetch` uses same-origin fetch on the web and Capacitor HTTP for native `/api/*` calls. It preserves bearer headers, restricts URLs to the configured HTTPS origin, and disables native credential-bearing redirects. Firebase SDK transport is separate; do not replace or monkey-patch it to fix an unrelated API request.

<!-- PAGE -->
# 05 / Environment and access transfer

## Local/public mobile configuration

Copy `mobile.env.example` to `.env.local` only when no working configuration already exists. The installers try prior release folders in Downloads, including v14.10. The package intentionally excludes `.env.local` and private credentials.

| Variable | Required value or source |
| --- | --- |
| NEXT_PUBLIC_API_BASE_URL | https://happy-solar-leads.vercel.app |
| NEXT_PUBLIC_FIREBASE_PROJECT_ID | gen-lang-client-0395385938 |
| NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN | gen-lang-client-0395385938.firebaseapp.com |
| NEXT_PUBLIC_FIREBASE_API_KEY | Existing Firebase web-app public config |
| NEXT_PUBLIC_FIREBASE_APP_ID | Existing web-app ID, validated with prefix 1:143988544112:web: |
| NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET | Existing public config, if used; expected project bucket below |
| NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID / MEASUREMENT_ID | Existing public config when applicable |

`NEXT_PUBLIC_NATIVE_BUILD` is set by the mobile builder. The builder deliberately removes `NEXT_PUBLIC_GEMINI_API_KEY`; do not ship a browser Gemini credential to restore the legacy AI page.

## Server-only configuration inventory

| Variable | Consumer / handling |
| --- | --- |
| FIREBASE_SERVICE_ACCOUNT | Core admin helper: app/utils/firebase-admin.ts |
| FIREBASE_STORAGE_BUCKET | Feedback; defaults to gen-lang-client-0395385938.firebasestorage.app |
| FIREBASE_SERVICE_ACCOUNT_JSON | Separate GHL Firestore helper |
| GCP_PROJECT_ID / FIRESTORE_DATABASE_ID | GHL mirror helper when configured |
| GHL_APPOINTMENT_EVENTS_COLLECTION | Optional GHL collection override; inspect helper for others |
| TERRITORY_TASK_QUEUE / TERRITORY_TASK_SECRET | Background assignment queue and worker authentication |

Transfer GitHub, Vercel, Firebase/GCP, Apple Developer/App Store Connect, Android signing/Play, and GHL access through the owner's existing secure process. Confirm who controls the production deployment and signing identities. No credential, provisioning profile, keystore, or account invitation is provided or created by this handoff.

<!-- PAGE -->
# 06 / Open and build on iPhone

The project installer requires macOS, Node 22+, and Xcode 26+. These are the checks in this repository, not a claim about the latest tool releases. The iOS project uses Swift Package Manager. Keep `package-lock.json` and use `npm ci`.

## From the supplied iOS ZIP

Place the ZIP in Downloads, then run:

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.11-ios.zip" \
  "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.11-ios" &&
bash scripts/mobile/install-ios.sh xcode
```

## From a GitHub checkout

After securely providing `.env.local`, run from the repository root:

```bash
bash scripts/mobile/install-ios.sh xcode
```

The installer runs dependency installation, a no-credential backend check, the configured static build, iOS assets, Capacitor sync, bundle verification, and Xcode opening. Its backend check may print a warning and continue: evaluate that warning before distributing a build.

For the supported simulator flow:

```bash
bash scripts/mobile/install-ios.sh simulator
```

## In Xcode

Open the App target, retain the existing signing team, and confirm **com.happyslr.raydar.next**, version **14.11**, build **151**. Use a physical iPhone for keyboard/GPS/microphone acceptance. To prepare TestFlight, select a generic iOS device, Archive, and distribute through the owner's existing App Store Connect workflow. If build 151 was already uploaded, obtain the next build number and update all version locations before rebuilding.

`RaydarViewController.swift` registers the custom `RaydarDictationPlugin`. Preserve that registration and the microphone/speech permission strings. Simulator behavior does not prove actual dictation reliability.

Neither the installer nor this handoff uploads the app or changes developer-account membership.

<!-- PAGE -->
# 07 / Android and release packaging

Use the existing Android Studio setup with Java/JVM 21. Source configuration targets SDK 36, minimum SDK 24, and Android Gradle plugin 8.13.0. Preserve the Gradle wrapper and lockfile instead of upgrading tooling during takeover.

## From the supplied Android ZIP

On the Mac, place the ZIP in Downloads, then run:

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.11-android.zip" \
  "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.11-android" &&
bash scripts/mobile/install-android.sh
```

The installer finds prior configuration, runs `npm ci`, probes the backend, then builds/syncs and opens Android Studio. Verify applicationId `com.happyslr.raydar.next`, versionName `14.11`, and versionCode `151`. The namespace remains `com.happyslr.raydar`.

## Shared manual build and checks

```bash
npm run mobile:build
npx --no-install cap sync
node scripts/mobile/check-bundle.mjs out
node scripts/mobile/check-bundle.mjs ios/App/App/public
node scripts/mobile/check-bundle.mjs android/app/src/main/assets/public
```

## Versioning and output rules

Update these three locations together for the next release: `app/mobile/_lib/release.json`, `ios/App/App.xcodeproj/project.pbxproj`, and `android/app/build.gradle`. Rebuild and sync after any frontend, public configuration, or native plugin change. An Xcode/Android build can otherwise include old copied web assets.

Keep the app ID and signing identity stable to preserve the update path. A debug APK is not the production release identity. Use the owner's existing signing/Play workflow for an AAB; the ZIP is not an installable signed app.

Exclude node_modules, build caches, `.env` files, service accounts, certificates and keystores from shared source packages. Preserve approved Signal R artwork under `resources/raydar-v5` and `public/brand/raydar-v5`; asset scripts regenerate the platform PNG files.

<!-- PAGE -->
# 08 / Backend deployment and current probes

The existing production API origin is `https://happy-solar-leads.vercel.app`. The mobile release is not a website replacement. If a backend change is needed, start from current production/main in an isolated branch and port only the required server files, reconciling newer work. Do not merge the whole mobile branch into the production website.

## Fresh read-only probe results

Checks ran during this handoff on October 17 UTC, without login credentials, through `npm run mobile:check-backend`.

| Endpoint | Observed result | Meaning |
| --- | --- | --- |
| /api/mobile-leads | Expected JSON 401 | Route present; authentication required |
| /api/mobile-feedback | Expected JSON 401 | Route present; authentication required |
| /api/territory-management | Expected JSON 401 | Route present; capabilities not established |
| /api/mobile-user-management | 404 | Optional route unavailable in this deployment |
| /api/field-config | 404 | Optional field service unavailable |
| /api/field-work | 404 | Optional field service unavailable |

These observations supersede the dated October 12 missing-route notes in `SERVER-V14.8.md`. A 401 confirms a route/authentication boundary, not successful data reads, writes, manager permissions, Storage signing, or background-task configuration.

## Required follow-up checks

- With approved tokens, verify personal and map access for setter, manager, and admin; reject inactive/revoked accounts and cross-team management actions.
- Read `/api/territory-management?summary=1` as an authorized manager/admin and inspect `pagedAssignments` and `backgroundAssignments` capabilities.
- Verify one designated knock and appointment request end to end, reading back typed timestamps, actor, history and GPS.
- Confirm feedback ownership, upload/retry behavior, and signed playback using a synthetic recording.

`SERVER-V14.8.md` documents bounded lead/feedback/territory services. `BOT-ONLY-V14.9.md` describes the optional durable task companion. They are implementation/deployment references, not proof that every capability is deployed. No production deployment or database mutation was performed for this transfer.

<!-- PAGE -->
# 09 / Data model and write contracts

## Main records

| Record or field group | Meaning / invariant |
| --- | --- |
| users/{uid} | Role, team, approval/activity state, proximity feature flag, current location |
| leads/{id} | Canonical visit/customer data, ownership, current status, inline history and CRM feedback |
| homeowners/{id} | Imported property information; treated read-only by the mobile workflow |
| territories/{id} | Polygon, assigned user, lifecycle and assignment progress |
| dispositions | Configured IDs, names, order, counting and special behaviors; status is dynamic |
| status / dispositionedAt | Current door result and original action time |
| dispositionHistory | Newest-first entries with disposition, timestamp, userId and userName |
| assignedTo / claimedBy / setterId | Different ownership/actor concepts; do not replace them on a normal disposition update |
| appointmentOutcome / ghl* | CRM feedback independent of door-knock disposition |

## Preserve the reporting contract

`knockPatch` validates the signed-in UID against the selected user. Capture the action time before awaiting GPS. Save Firestore Timestamp values through the existing conversion path, not formatted date strings. Preserve disposition IDs from the active configuration and the actor's UID/name.

`mergeReportingPatch` recognizes retries by actor, action time, and disposition. A delayed older knock can add its original history entry, but must not move a newer status/GPS backward in time. The existing lead transaction merges against current server history.

New manual leads use a create-once path whose ID/actor/claim must match the draft and signed-in rep. A lost acknowledgement must not create another document. Historical territory pins cannot be dispositioned. Claims/unclaims are explicit ownership actions and remain separate from normal knock saves.

## Grouping is presentation only

One pin does not mean one stored historical document. House grouping and combined history are display projections. Never write the aggregated history back into a selected lead, delete duplicate-looking records as cleanup, or edit imported homeowner coordinates to fix marker placement. These actions could corrupt reporting or the history of different reps.

<!-- PAGE -->
# 10 / Outbox, offline work, and GPS

Native builds set `DIRECT_MOBILE_WRITES`. Optional field API capture remains disabled. Ordinary native knocks do not depend on `/api/field-work` or `/api/field-config` being deployed.

## Durable action lifecycle

1. Capture actor, lead, selected disposition and original time.
2. Persist a draft to account-scoped IndexedDB storage before relying on a network write.
3. Show the provisional result while its sync state remains distinguishable.
4. Resolve pending GPS within the original capture window and account context.
5. Commit through the existing create-once or Firestore transaction path.
6. Keep an acknowledged result visible until normal reads reflect it. Retain blocked/failed drafts for recovery.

`deviceStore.ts` uses database `raydar-field-v11`, with drafts and prepared areas. `useFieldData.ts`, `syncOutbox.ts`, `pendingGps.ts`, and `confirmedKnocks.ts` coordinate replay and the display overlay. Prepared areas are user-scoped and expire after 24 hours; this is not unlimited offline access to all company records.

## Location invariants

The proximity distance is 50 meters, approximately 164 feet. Current enforcement applies to setter/manager and the historical sales role unless `features.proximityEnforcement` is explicitly false. Preserve existing role/exemption behavior.

A GPS fix must belong to the action's capture window. Expired drafts must not request a fresh current location and pretend it proves an old knock. Invalid, out-of-range, expired or denied verification must remain reviewable rather than be reported as successful. Asynchronous GPS completion must not resurrect a discarded draft or cross an account switch.

## Recovery rules

Keep the app installed and its storage intact while knocks or recordings are unsynced. Resume with the original account. Do not relabel an unsynced action as a server-confirmed success. Test force-close/reopen, loss of acknowledgement, offline/reconnect, stale GPS, discarded drafts and account switching with approved synthetic records.

Initial sign-in, uncached map tiles, remote data and scheduling requests require connectivity. No background GPS service, complete offline map download, or native push-notification delivery was added.

<!-- PAGE -->
# 11 / Pin correctness and the v14.11 repair

## Rendering pipeline

`useLiveLeads` and `useViewportLeads` deliver overlapping snapshots. `mergeLeadSnapshots` reconciles the same document by latest visit time. `groupHouseLeads` joins visits for a house, and `latestKnockDisplay` derives the newest configured result before display filters. `LeadMap` and the homeowner index place one visible marker at the corrected rooftop anchor when available.

## Identity and event ordering

- Normalize street suffixes and full postal addresses. Nearby postal-town aliases can match; different street numbers are never merged just because their roofs are close.
- Existing shared homeowner IDs can identify the same property. Grouping compares all matching candidates so page order does not change the result.
- Prefer the latest valid knock event, accepting Date, ISO and serialized Firestore timestamps. Missing history timestamps do not become the current time.
- If history is explicitly newer than the canonical status timestamp, its configured disposition drives the display. The canonical status wins a timestamp tie. Unknown labels are not invented as new status IDs.

## Stability during refresh

Previously, an uncached map view could publish an empty list before returning data, and an older personal snapshot could overwrite a newer viewport record. v14.11 retains known in-scope records during loading/partial/error responses and reconciles event versions. Only a complete successful view can remove records missing from that view. Authorization failures clear the relevant cached view scope.

Corrected anchors remain available while homeowner tiles refresh. A new winning visit ID reuses the existing house marker. Unchanged icon HTML is not reset on every object update. Duplicate homeowner import rows are collapsed for display.

## Limits to remember

The winner is the newest **loaded** record, not proof that every historical document in the database has been discovered. Dense areas may need Load more pins or a closer zoom. Grouping is heuristic: investigate genuine address/data-quality collisions with minimal scoped reads, preserving original records. Appointment outcome badges stay independent from the knock symbol.

<!-- PAGE -->
# 12 / Read budgets, cache behavior, and costs

| Path | Current bounds / behavior |
| --- | --- |
| Map API | Street-level zoom 15+; latitude-index scan; server page maximum 500; longitude/polygon filtering after scan |
| Automatic viewport load | Two pages per settled view; up to 1,000 scanned records |
| Load more pins | Resumes cursor for up to two more pages per user action |
| Viewport memory | Five-minute cache; six cached views; at most 6,000 retained leads |
| Personal API | 500-record pages; assigned/claimed/follow-up scope, 35-day recent activity behavior; 15-minute cache |
| Personal retained result | More than 6,000 records produces an error instead of presenting false complete totals |
| Homeowner ranges | Up to 500 records/query; 2,000 reads and 12 queries per view budget |
| Homeowner coverage | Geohash ranges, 30-day coverage TTL; bounded in-memory tile/record retention |
| Selected-house history | Eight older summaries initially, four reads concurrently, eight more only on request; five-minute cache capped at 96 records |
| Territory assignment | Existing transaction batches scan up to 200 records; task worker bounded to 10 pages per invocation |

The server's map cursor advances through scanned latitude records, including records later filtered out. An empty response page can therefore still have a next cursor. Do not treat an empty partial page as deletion or complete geographic coverage.

API summaries reduce network payload and phone memory; they do not automatically reduce billed Firestore document reads. Avoid company-wide realtime subscriptions, whole-collection deduplication scans, automatic unbounded pagination, or repeated rereads of the same personal page.

Preserve corrected `lat`, `lng`, and `geohash` fields for homeowner placement. Source/original coordinate metadata is not a fallback map location. The homeowner loader is read-only and deliberately bounded.

No claim of lower or unchanged production bills is established. Measure actual Firestore reads, API latency, Cloud Tasks operations and feedback Storage use during the pilot. Do not raise quotas, add paid AI, or perform large migrations as an incidental takeover step.

<!-- PAGE -->
# 13 / Territory assignment and worker operations

Territory boundaries, lead eligibility and company/team permissions must remain intact. Assignment must preserve worked/claimed leads and all visit history. Territory deletion/archiving is not permission to delete the area's leads.

## v14.8 foundation

The paged implementation supports preview/begin/continue actions and resumable batches. `territoryManagement.ts`, `territoryManagementV2.ts`, and `territoryManager.ts` hold the behavior. Existing actions must continue working for older installed builds. Authenticated capability checks are required; a no-token 401 says nothing about paging support.

## v14.9 background design

`save-background-assignment` saves the boundary and queues work, rather than making the phone complete a long preview/assignment scan. `retry-background-assignment` resumes persisted progress. The worker route is `/api/territory-assignment-worker`; its application authentication uses `X-Raydar-Task-Secret` and a server-only secret.

The configured queue path must belong to project `gen-lang-client-0395385938`. The reference setup uses region us-central1 and queue raydar-territories. Inspect the actual infrastructure before assuming those resources exist. The queue enqueuer permission is distinct from Firebase admin access.

The design limits the worker to 60 seconds and up to 10 pages / 2,000 scanned records per task, enqueuing continuation from a persisted cursor. Reference queue limits are one concurrent dispatch, one dispatch per second and five attempts. Exact deployed limits and successful app-closed processing are **not verified by this handoff**.

## Operational verification

With an approved test territory, verify `queued:true`, progress while the app is closed, idempotent repeated requests, pause/resume, permission revocation, and preservation of worked leads. A queue failure must retain the boundary and expose retry; it must not claim successful assignment.

Use `docs/mobile-next/BOT-ONLY-V14.9.md` for the server-file inventory and configuration recipe. If rolling back this worker, pause the queue before promoting the previous compatible backend. Preserve boundaries/cursors and lead records. This transfer does not authorize or perform queue creation, IAM changes, paid-plan changes, or a deployment.

<!-- PAGE -->
# 14 / Integrations and device-specific code

## Scheduling Manager

The existing scheduling UI uses configured admin settings and the existing webhook payload. `schedulingWebhook.ts` uses HTTPS native HTTP without redirects. Do not auto-retry a scheduling request after an ambiguous response: the provider may already have delivered it. Native appointment submission waits for the lead's pending write to be synchronized. Verify one approved test request with the actual receiving service.

## GHL appointment outcomes

Mobile manager/admin controls call `/api/admin/sync-appointments`. The GHL mirror helper uses its own server-only service-account environment name and optional project/database/collection overrides. Outcome fields such as appointmentOutcome, GHL statuses and timestamps drive a separate feedback badge.

A Sold outcome must not silently overwrite status, dispositionHistory, assignedTo or claimedBy. Unknown/custom outcome labels remain recognizable. This app work did not establish an automatic GHL polling schedule; verify the existing upstream synchronization and the rep's cache refresh path.

## Feedback recordings

`/api/mobile-feedback` stores private feedback objects under `raydar-feedback/{uid}/...` in the project bucket. The design limits recordings to two minutes / 2 MiB, preserves failed local uploads, uses create preconditions for replay, restricts team review to admins, and issues 15-minute review URLs. There is no newly added paid transcription service or automatic retention deletion. Route presence is verified; actual bucket permissions and playback still require authorized tests.

## Business cards

Current implementation: a browser link to `https://happy-solar-bloom-portal.vercel.app/business-card`, exposed through `BusinessCardTool.tsx`. Native per-homeowner sending, unique tracked links, open events and Radar alerts are future scope.

## Native runtime and dictation

`NativeRuntime.tsx` handles native lifecycle/network/back behavior. `dismissMobileOverlay.ts` closes the open dialog before leaving the page. iOS dictation uses `RaydarDictationPlugin.swift` registered by `RaydarViewController.swift`. Preserve speech/microphone permission handling and typed-note fallback. Test actual devices; browser fixtures cannot prove microphone, native permissions, foreground resume or keyboard behavior.

<!-- PAGE -->
# 15 / Verification record and repeatable commands

## Verified for the October 15 release

- All 146 mobile tests passed with test concurrency 1. The 10,000-lead / 1,500-homeowner matching check took about 487 ms in that run.
- Mobile-sized Chromium checks at 393x852 and 360x640 confirmed one pin for four visit records, combined history, homeowner-layer-off behavior, latest result, marker reuse and retention through partial/failed refreshes.
- Form checks simulated visible viewport heights of 320/260 pixels and a 35-pixel offset. The last field scrolled into view and Save Lead remained reachable; manual save created one record with the existing time/actor/GPS contract.
- Production static export/TypeScript, both native asset generators, Capacitor sync, and bundle-version checks passed. Native compilation/signing were not run.

```bash
npm ci
node --import tsx --test --test-concurrency=1 tests/mobile/*.test.ts
npx tsc --noEmit
node scripts/mobile/check-export.mjs --audit
npx playwright install chromium
```

The audit export substitutes fictional Firebase adapters and writes `/tmp/raydar-ui-audit-out`. Never install or package that synthetic output as the production app.

```bash
export CHROMIUM_EXECUTABLE="$(node --input-type=module -e \
  "import {chromium} from 'playwright'; console.log(chromium.executablePath())")"
node scripts/mobile/check-pin-stability-v1411.mjs
node scripts/mobile/check-viewport-stability-v1411.mjs
```

These scripts require Python 3 for their local HTTP server and block non-local production traffic. If browser installation is unavailable, report the blocked browser check rather than claim it passed. After auditing, use `npm run mobile:build` for the real production-configured export.

## Known validation limitations

The default parallel test run exceeded an existing one-second spatial timing threshold under contention; isolated and full serial runs passed without loosening it. Reviewed legacy map/page files retain 27 lint errors, with no new diagnostics from the v14.11 changes. Do not describe the repository as lint-clean or suppress existing gates to obtain a green result. See `VERIFY-V14.11.md` and `.json` for the detailed record.

<!-- PAGE -->
# 16 / Physical-device acceptance and release gate

Use a designated test account, test leads and test territory. Record platform/OS, app version/build, backend deployment, source SHA, expected/actual outcome and evidence. Current endpoint probes and browser fixtures are not substitutes for these checks.

| Test | Required observation |
| --- | --- |
| Fresh login and reopen | Correct account/role loads; session restores without an indefinite spinner |
| Account switch / revoked access | No prior user's protected data or pending actions leak to the next user |
| Latest knock / duplicate visits | One house pin matches newest loaded history; neighbors remain separate |
| Homeowner layer on/off | Grouping remains correct and corrected anchors do not jump during reload |
| Slow/failed map refresh | Existing in-scope pins persist; Retry and Load more accept taps |
| Manual pin + keyboard | Long press opens form; final field and Save are accessible on a short phone |
| Save and reporting | One committed action with original Timestamp, actor, GPS and correct reporting after refresh |
| Offline + force-close | Draft survives; reconnect commits once; ambiguous acknowledgements do not duplicate history |
| GPS denied/stale/far away | Existing proximity rules hold; blocked action is recoverable and not called successful |
| Scheduling request | Lead synchronized before send; receiving service gets one expected payload |
| GHL outcome update | Correct badge changes after existing sync/refresh; knock/ownership stay unchanged |
| Background territory work | Authorized capability present; approved boundary progresses with app closed |
| Feedback/dictation | Permissions, record/cancel, failed upload/retry and authorized playback work |
| Native lifecycle | Repeated background/resume, Android Back, rotation and larger text remain usable |

## Before wider distribution

Confirm the existing app/store identity, signing owner, next unused build number, backend compatibility and the recipient test group. Retain the last known usable build. A new binary upload, backend deployment and device rollout are separate steps with separate evidence.

If a regression appears, keep unsynced device data intact, capture minimal sanitized diagnostics, reproduce with a test record, and use the previous compatible build/deployment through the established release process. Never roll back by deleting lead/history records or clearing a device's pending work.

<!-- PAGE -->
# 17 / Troubleshooting runbook

| Symptom | Inspect first | Safe next step |
| --- | --- | --- |
| Older/wrong pin result | Event timestamps, loaded pages, merge inputs and disposition mapping | Compare scoped source records; load remaining pages; preserve history |
| Missing pins | Active filters, role/territory, zoom, API errors, partial cursor | Clear only intended display filters; retry/narrow viewport; verify access |
| Flashing on pan | Empty publishes, marker recreation, changing anchors | Reproduce with delayed pages; inspect v14.11 viewport/marker logic |
| Two pins at a house | Normalized address, town/state, shared homeowner ID | Check identity inputs; never bulk-delete duplicate-looking visits |
| Save hidden by keyboard | Dialog size, visualViewport height/offset, field scroll container | Test short physical device; retain header/footer outside the scrolling fields |
| Action remains unsynced | Original account, connectivity, blocked GPS, storage, permissions | Review queue error; preserve draft; do not replace old GPS with a new location |
| Login spins / profile unavailable | Auth callback, user profile, approval, network, startup diagnostics | Follow surfaced retry/error; verify profile and native transport |
| API 401/403 | Expired/revoked token, inactive/unapproved user, permissions | Reauthenticate/check authorized role; never loosen rules to hide the failure |
| API 404 | Deployed backend vs source-only route | Probe exact origin; optional field routes are currently absent |
| Territory stalled | queued flag, queueError, task attempts, worker auth, persisted cursor | Authorized retry from saved progress; investigate queue rather than rescan from zero |
| Old UI in native project | out manifest and copied native public manifest | Rebuild, sync, and run check-bundle for the target platform |
| Empty history detail | Full-record reads, summary flags, selected-house limits | Retry history / Load older records; do not rewrite aggregate history |

## Diagnostics and boundaries

Useful starting points are `startupDiagnostics.ts`, `scripts/mobile/debug-ios.sh`, native console logs, `raydar-build.json`, and the visible unsynced/recovery state. Record versions, IDs and timestamps only as needed; redact tokens, private credentials and homeowner contact information from shared reports.

Do not run `npm run reset`, `setup-test`, `gen-leads`, or `gen-users` against the live environment. Those names refer to legacy data-management scripts, not the isolated mobile regression suite. Do not deploy the repository's Firestore rules/index files just to solve a client error; compare with the actual deployed policy first.

<!-- PAGE -->
# 18 / Future scope and decision points

The following ideas were discussed with the owner but were not implemented in v14.11. The order below is a suggested implementation sequence based on current code, not an approved schedule or fixed effort estimate.

## Walking-camera follow

The GPS dot updates continuously, but the map currently centers on an initial fix or the explicit GPS control. Add an opt-in follow state that recenters as the user walks. Manual pan should suspend follow; the GPS button should restore it. Preserve user zoom, avoid jitter and excessive network reads, pause/resume location correctly, and test battery/network behavior on a real walking route. Likely the smallest isolated change of these three.

## Two-finger map rotation / roof inspection

The current map is Leaflet with ordinary zoom/pan gestures. No requested rotate-map feature was added. Prototype rotation against actual satellite tiles, homeowner canvas, DOM pins, popups, hit targets and long-press detection before committing to a plugin or map-engine migration. Rotating overhead imagery does not itself provide oblique/3D roof imagery. Provider choice, imagery capability, licensing/cost and native touch behavior are decisions still to make.

## Business-card sending and open alerts

The current feature only opens the external Bloom card creator. A full integration needs a clear rep/card identity, a homeowner-send flow, a unique link per intended attribution unit, an event store, authenticated access and a Radar notification surface. Decide whether sending opens the phone's SMS sheet or uses a messaging provider, and whether alerts are in-app only or require native push.

Treat an open as an observed link event, not guaranteed proof a homeowner read it. Preview bots, scanners, forwarded links and repeat visits complicate attribution. Define deduplication, event labels, retention and permissions before rollout. Coordinate any required changes with the Bloom source/deployment owner; that separate app's source is not included in this Raydar handoff.

## First maintenance priorities

Complete physical acceptance for v14.11, confirm authenticated backend/worker capabilities, establish the existing signing and deployment workflow, then address reproducible defects. Preserve working behavior and produce reviewable commits and updated evidence for each next change. Do not quietly bundle these future features into a bug-fix release.

<!-- PAGE -->
# 19 / Source map and authoritative references

All paths below are relative to the repository root. This manual's technical statements were checked against the v14.11 source and release evidence; historical docs are useful context but are not automatically current.

| Responsibility | Starting files |
| --- | --- |
| Version / native identity | app/mobile/_lib/release.json; capacitor.config.ts; platform build files |
| Mobile session and shared data | app/mobile/_lib/mobileSession.ts; app/mobile/_components/MobileDataProvider.tsx |
| Personal / viewport snapshots | app/hooks/useLiveLeads.ts; app/hooks/useViewportLeads.ts |
| Knock page / filters / scope | app/mobile/knocking/page.tsx; app/mobile/_lib/mapFilters.ts; pinScope.ts |
| Map / icons / manual form | app/components/LeadMap.tsx; AddLeadModal.tsx; app/utils/fieldPin.ts |
| House identity and history | app/homeowners/houseIdentity.ts; model.ts; HouseHistory.tsx |
| Homeowner reads and cache | app/homeowners/source.ts; loader.ts; cache.ts; useHomeowners.ts |
| Durable actions and GPS | app/field/useFieldData.ts; deviceStore.ts; directWrites.ts; pendingGps.ts |
| Reporting and replay | app/field/knockPatch.ts; syncOutbox.ts; createLeadOnce.ts; confirmedKnocks.ts |
| Server leads / feedback | app/utils/server/mobileLeads.ts; mobileFeedback.ts; matching app/api routes |
| Territory and task worker | app/utils/server/territoryManagement.ts; territoryManagementV2.ts; territoryQueue.ts |
| Auth / native transport | app/utils/firebase.ts; firebase-admin.ts; apiFetch.ts; app/components/NativeRuntime.tsx |
| CRM / appointment send | app/utils/ghl-firestore.ts; schedulingWebhook.ts; app/components/LeadEditorModal.tsx |
| Dictation | app/field/DictateButton.tsx; ios/App/App/RaydarDictationPlugin.swift; RaydarViewController.swift |

## Read next

`docs/mobile-next/RELEASE-V14.11.md` and `VERIFY-V14.11.md/.json` contain release-specific behavior and evidence. `SERVER-V14.8.md` and `BOT-ONLY-V14.9.md` describe backend companions. `scripts/mobile/build.mjs`, `production-config.mjs`, `check-backend.mjs`, `check-bundle.mjs`, and `install-ios.sh` / `install-android.sh` are executable setup references.

Start with the new tests in `tests/mobile/pin-stability-v1411.test.ts` and the two v1411 browser scripts, then inspect the neighboring tests for write/reporting, GPS, territory, authentication and transport behavior. Paths in earlier setup docs must be checked against the current tree before use.

<!-- PAGE -->
# 20 / Bot handoff instructions and completion record

## Copy-ready takeover instruction

You are taking over the existing Happy Solar Raydar mobile project. Start with `docs/handoff/v14.11/BOT-START-HERE.md` and `HANDOFF.md` on branch `codex/raydar-grok-handoff-v14-11` in `HappySolarCoder/happy-solar-leads`. The runtime baseline is v14.11/build151 and GitHub commit `337461c2a4fd2a66d4c624be1da5c4959fa242a5`.

Inspect the current checkout and protect any newer owner work. Reproduce the documented serial tests and confirm the release identity before making changes. Preserve one latest-loaded-knock pin per house, raw visit history, role/territory scope, original action timestamps, actor/GPS fields, direct native outbox/replay behavior, and explicit ownership actions.

Use the existing production API/Firebase project and native app identity. Obtain configuration through the existing secure channel. Keep private credentials out of source and public variables. Do not treat absent optional field endpoints as permission to change the native write path. Do not deploy the mobile frontend as the company website, reset live data, bulk-deduplicate leads, edit homeowner imports, clear pending device work, or relax rules as troubleshooting shortcuts.

First establish authenticated backend, physical-device, signing and worker status. Use the acceptance checklist and approved test records. Mark checks as passed, failed or not tested with concrete evidence. Treat walking-camera follow, map rotation and card-open alerts as separate future work to scope with the owner. Deliver precise file/commit/build references and remaining limits after each change.

## Transfer completion record

| Area | State at transfer |
| --- | --- |
| Application baseline | v14.11/151 source and platform packages verified |
| GitHub | Full source on release branch; PDF/manual and companion files on handoff branch |
| User download | Full transfer ZIP with documentation, source snapshot and both original native packages |
| Live route presence | Three required routes returned expected JSON 401; optional field/user routes returned 404 |
| Historical verification | 146 serial tests, browser scenarios, configured export and sync passed |
| Physical/store/authenticated checks | Pending confirmation by receiving bot and owner |
| Credentials / signing / cloud ownership | Must be supplied or granted through existing secure channels |

The PDF and companions are a point-in-time handoff. Once the new bot changes the project, it should update the version, release manifest, tests and operating notes together so the next transfer has a clear source of truth.
