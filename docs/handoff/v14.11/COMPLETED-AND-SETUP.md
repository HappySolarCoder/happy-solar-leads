# Raydar completion and setup record

Happy Solar | Through v14.11 / build 151 | October 16, 2026, America/Phoenix

## What has been accomplished

Raydar has a shared mobile application, configured iOS and Android native projects, repeatable build/install scripts, existing Firebase and HTTPS backend integration, field workflows, durable offline knock recovery, release verification, and a published GitHub handoff. The latest delivered source/project packages are **v14.11 / build 151**.

Earlier records establish a Mac mini / Xcode 27 workflow, an available iPhone simulator, and the user's confirmation of automatic signing. Later release notes refer to an existing **Raydar Canvassing** App Store Connect record and TestFlight tester group. Those existing resources should be located and reused by the receiving bot. Their current account details and latest uploaded build were not inspected during this transfer.

This document adds the setup history and completion ledger to the technical handoff. It records progress already made without turning an instruction, source setting, or successful browser test into proof of a completed store release.

## How to read status

| Status | Meaning |
| --- | --- |
| Verified | Present in inspected source, published files, executed checks, or recorded release evidence |
| Previously confirmed | Earlier user confirmation or device/log evidence preserved in project records |
| Documented existing | Later project instructions explicitly refer to an existing resource; its live account state was not inspected |
| Needs confirmation | The available record does not establish completion or current state; this does not mean it was never done |

## Scope and navigation

Sections 01-02 summarize completion and release milestones. Sections 03-07 cover Xcode, Apple signing, App Store Connect, TestFlight, Android Studio and Android distribution. Sections 08-11 cover cloud services, integrations, app functionality and validation. Sections 12-13 contain operating commands, access details to preserve, and evidence references.

No accounts, signing identities, store records, cloud projects or deployments were created or changed while preparing this record. No private credentials are included. Source references such as [S1] and [H1] are explained in section 13.

<!-- PAGE -->
# 01 / Completion ledger

| Area | Recorded completion / setup | Status |
| --- | --- | --- |
| Shared app | Next.js/React mobile UI, Capacitor containers, Leaflet maps, Firebase integration | Verified in source |
| Latest release | 14.11 / 151; iOS and Android source packages with configured web assets | Verified and delivered |
| GitHub | Full source and handoff published in HappySolarCoder/happy-solar-leads | Verified |
| Mac / Xcode | Mac mini workflow and Xcode 27 reported in earlier work | Previously confirmed |
| iOS Simulator | v14.1 notes record a booted iPhone 17 on iOS 27; later native logs used for diagnosis | Previously confirmed in project record |
| Automatic signing | Earlier conversation reports user confirmation; both Xcode configurations use Automatic | Previously confirmed / source verified |
| Apple team | Later notes refer to existing paid development team; exact Team ID and current membership unavailable | Documented existing; details need confirmation |
| App Store Connect | Later guide names an existing Raydar Canvassing app record | Documented existing |
| TestFlight | Later guide refers to an existing tester group | Documented existing; latest build/review/link need confirmation |
| Android Studio | Installer, Gradle project, JVM/SDK requirements and Samsung/emulator workflow prepared | Source/workflow verified; workstation state unconfirmed |
| Google Play / release key | No verified release keystore, Play app record, signing enrollment or production track in the transfer | Needs confirmation |
| Firebase / backend | Existing project pinned; required route authentication boundaries observed | Configuration and route presence verified |
| Territory worker | Resumable Cloud Tasks companion implemented and documented | Source verified; live queue/IAM/delivery unconfirmed |
| Device acceptance | Historical simulator diagnostics and synthetic browser checks available | Latest physical-device acceptance needs confirmation |

## Current identity to preserve

Native display name: **Raydar Next**. iOS bundle ID and Android applicationId: **com.happyslr.raydar.next**. Android namespace: **com.happyslr.raydar**. App Store Connect's documented name, Raydar Canvassing, can differ from the home-screen display name. Locate the Apple record by bundle ID before making changes. [S1, S2, S3, H1]

<!-- PAGE -->
# 02 / Completed development milestones

The following is a source-based history of delivered work. Each release's implementation and isolated checks are distinct from deployment or store-upload status. Earlier values describe history; use v14.11 configuration for the next build. [S4]

| Milestone | Work delivered |
| --- | --- |
| Branding and mobile shell | Signal R artwork, slate-blue/yellow styling, Today/Knock/Follow-ups/Progress flows, native icon/splash generation and mobile navigation |
| v6-v8 field controls | Warm-lead identification; compact roof/pin presentation; compass integration; map tools; Focus session counts; rectangle/corners/draw territory workflows; explicit town/ZIP search |
| v10-v11 field foundation | Management backend companion instructions; repeatable installer; field notes/dictation tools and recovery/prepared-area infrastructure |
| v12 homeowner layer | Read-only imported homeowner data, bounded geohash reads, owner details, saved coverage, canvas rendering and account-aware controls |
| v12.3-v12.7 reliability | Homeowner rendering/cache work; corrected coordinate refresh; direct native reporting contract; durable original-time writes and retries; compact neighborhood pins |
| v13 | Repackaged v12.7 as the next named release; retained app identity and existing behavior |
| v14.1-v14.4 iPhone work | Startup/auth recovery and native Firebase persistence; Xcode/Device Hub simulator workflow; native diagnostics; automatic Firestore transport selection after earlier log analysis |
| v14.5 | NH/NI/CSM quick-action row; personal follow-up scope and bulk reminder cleanup; Progress safe-area fix; territory deletion retaining leads; pinned asset tooling |
| v14.6-v14.8 | Territory continuation/geometry repairs; iOS dictation bridge work; bounded personal/viewport reads; immediate local save state; GPS watcher cleanup; recoverable errors; private voice-feedback flow |
| v14.9 | Background territory assignment companion; persisted batch continuation; local save completion before deferred GPS sync; failure/retry state |
| v14.10 | Larger worked pins; grouped house histories; long-press manual pins; durable manual saves; Bloom business-card link |
| v14.11 | Latest-event reconciliation; stronger one-house grouping; stable markers during partial/error refresh; Load more pins; keyboard-aware Add New Lead dialog and reachable Save |

## Technical handoff completed

The transfer includes a 21-page technical manual, searchable Markdown, bot start instructions, acceptance checklist, manifest/checksums, a 604-file tracked-source snapshot, and unchanged original iOS/Android ZIPs. The new setup record supplements that package; it does not change the app version or runtime behavior. [S1]

<!-- PAGE -->
# 03 / Xcode and the Mac workflow

## What is already established

Earlier setup history reports **Xcode 27 on the Mac mini**. The checked-in iPhone guide records a v14.1 log showing an available, booted **iPhone 17 simulator on iOS 27**. The v14.4 notes analyze a supplied native log from the earlier app. This supports an established simulator/diagnostic workflow, not merely a proposed installation. The current Mac was not remotely inspected for this PDF. [S2, S5, H1]

## Project configuration already prepared

| Setting / resource | Current source value |
| --- | --- |
| Xcode project | ios/App/App.xcodeproj; scheme and target App |
| Installer requirements | macOS, Node 22+, Xcode 26+; existing Xcode 27 report satisfies the version check |
| Dependency management | Swift Package Manager; preserve package resolution and npm lockfile |
| Bundle ID / version / build | com.happyslr.raydar.next / 14.11 / 151 |
| iOS deployment target | 15.0 in the Xcode project; installed toolchain/dependencies must still compile successfully |
| Signing setting | CODE_SIGN_STYLE = Automatic for Debug and Release |
| Bundled UI | Capacitor webDir out; packaged web assets, no remote server.url |
| Runtime | Existing storyboard/scene wiring and RaydarViewController; custom dictation plugin registration |
| Permissions | Location, microphone and speech-recognition usage descriptions included |

## Repeatable commands already provided

From the fresh v14.11 source folder with the working mobile configuration:

```bash
bash scripts/mobile/install-ios.sh xcode
```

This installs dependencies, checks the backend, builds/syncs the web assets, verifies the bundle and opens Xcode. The simulator path is:

```bash
bash scripts/mobile/install-ios.sh simulator
npm run mobile:ios:location -- rochester
npm run mobile:ios:debug
```

The location command supplies a simulator location; it does not prove physical GPS. Debugging writes logs on the Mac's Desktop; Control+C ends logging. The installer updates the same app identity. Preserve local pending knocks and recordings; do not uninstall or erase the simulator as routine troubleshooting.

## Remaining evidence

The current selected developer path, installed Node version, latest successful native compile, and real-device run for v14.11 were not verified here. The receiving bot should inspect the existing Mac setup before reinstalling tools or creating another simulator. [S2, S3, S5]

<!-- PAGE -->
# 04 / Apple signing and App Store Connect

## Completion already recorded

The earlier setup conversation reports that the user confirmed **automatic signing**. Current source also enables automatic signing. Later v14.8 instructions explicitly say to use the **existing paid development team** and the **existing Raydar Canvassing App Store Connect record**. Carry these forward as existing setup references. [H1, S2, S3]

No DEVELOPMENT_TEAM identifier is committed in the inspected Xcode project. The actual selected team, paid-membership status, certificates and provisioning profiles remain account/Mac state; they cannot be recovered from that source setting alone.

| Apple item | Recorded value / handoff treatment |
| --- | --- |
| App record name | Raydar Canvassing, as named by the later v14.8 guide; live record not opened during transfer |
| Bundle ID to match | com.happyslr.raydar.next |
| Native home-screen name | Raydar Next; distinct from store record naming |
| Platform / current source version | iOS / 14.11 / build 151 |
| Signing mode | Automatic; earlier user confirmation retained |
| Apple Team ID / legal organization | Not recorded in this transfer; read the existing account/project selection |
| App Store Connect numeric Apple ID | Not recorded; obtain from the existing app record |
| Actual SKU | Not verified; earlier instructions proposed different values, so use the actual record |
| Membership / agreements / certificate validity | Current status not inspected |

## Naming conflicts resolved for the new bot

Earlier instructions proposed names such as Raydar Next or Raydar Field and SKUs such as raydar-next-ios or raydar-next. These are historical suggestions, not authoritative proof of what was entered. The later guide's Raydar Canvassing reference is the best documented existing app name. The stable bundle ID is the stronger matching key. Do not create a duplicate app just because the old suggested name differs. [S2, H1]

## Preserve the working signing relationship

On the existing Mac, inspect Xcode's App target, Signing & Capabilities, and the selected team. Match that team to the existing Apple developer account and App Store Connect app. If the identifier belongs to a different team, resolve ownership before changing it. Preserve the existing private keys and provisioning workflow through the owner's secure access process.

This PDF does not claim that build 151 is signed or uploaded. Source automatic signing, team selection, a successful archive, an uploaded build and an approved beta are separate completion points.

<!-- PAGE -->
# 05 / TestFlight and Apple distribution

## Established workflow and recorded state

The project established TestFlight as the iPhone staff-pilot workflow. The later v14.8 guide refers to an existing tester group and an existing App Store Connect app. The group's exact name, invitation/public link, latest assigned build, tester count and review status were not recovered. No Apple upload was performed during the v14.11 source verification or the handoff. That statement does not rule out uploads the owner completed separately. [S2, S6]

## Existing upload flow to continue

1. Build/sync the intended source with `bash scripts/mobile/install-ios.sh xcode`.
2. Confirm the existing team, bundle ID and intended version/build; check the Apple record for already-used build numbers.
3. Select a generic physical iOS device destination, archive through Xcode, then upload through Organizer's App Store Connect distribution flow.
4. Wait for processing, resolve the actual compliance/validation prompts, and add the processed build to the appropriate existing testing group.
5. Check whether review or manual distribution is required before telling testers to update.

Internal Apple testers are App Store Connect users with access. Ordinary staff can be external testers without receiving administration access. External beta review can be required, and TestFlight builds are available for up to 90 days. These are Apple distribution rules, not evidence that Raydar has passed them. [A1, A2]

| Completion point | Evidence available now |
| --- | --- |
| Pilot distribution plan | TestFlight workflow documented |
| Existing app / group reference | Present in later v14.8 instructions |
| Latest archive and upload receipt | Not supplied in the transfer |
| Build 151 processed in Apple account | Not verified |
| Beta review / export-compliance status | Not verified |
| Assigned tester group / install link | Exact values not verified |
| Successful install and update on a physical iPhone | Not established for the current release |
| Public App Store publication | Not established; not performed for this handoff |

## Reviewer and release information to retain

Keep the real beta description, What to Test, feedback/reviewer contact, and working least-privileged reviewer account with the existing app record. Explain the real map/location flow and that scheduling can send a real request. Do not invent review credentials or claim app review approval.

The ZIP is a source/project package, not an IPA install link. Future private permanent distribution was discussed in earlier notes, but no Apple Business Manager / Custom Apps setup is established by the available record. [S2]

<!-- PAGE -->
# 06 / Android Studio and local Android builds

## What has been prepared and retained

The Android project, installer, web-bundle synchronization, native assets and device-run instructions are included. Earlier guides target a connected **Galaxy S25 / Samsung phone** or an emulator. This establishes the intended testing workflow; the records retrieved for this PDF do not establish the currently installed Android Studio version or a completed v14.11 run on that phone. [S3, S4]

| Configuration | Current value / location |
| --- | --- |
| Project folder | android/; open through the installer or cap open android |
| applicationId | com.happyslr.raydar.next |
| Java namespace | com.happyslr.raydar; intentionally different from applicationId |
| Version | versionName 14.11; versionCode 151 |
| Java / Gradle runtime | JVM 21 required by the existing project workflow |
| Android SDK | compileSdk 36, targetSdk 36, minSdk 24 |
| Android Gradle plugin | 8.13.0; retain the checked-in wrapper/configuration |
| Web assets | android/app/src/main/assets/public |
| Native configuration | HTTPS local scheme; mixed content disabled; native keyboard resize |
| Platform capabilities | Existing compass/dictation integrations and microphone/location flows retained |

## Repeatable workflow

From the fresh source folder with the existing mobile configuration:

```bash
bash scripts/mobile/install-android.sh
```

The installer reuses prior configuration when available, installs locked dependencies, probes the backend, builds the mobile web bundle, syncs Capacitor and opens Android Studio. Let Gradle sync complete, select the connected phone or emulator, and Run. Review actual errors rather than accepting unrelated toolchain upgrades during takeover.

To reopen an already built/synced project:

```bash
npx --no-install cap open android
```

Opening the IDE alone does not refresh copied web assets. After frontend/configuration changes, rerun the build/sync workflow. Check the displayed version and native bundle manifest before testing.

## What remains to document

Installed Studio version, JVM selection, SDK availability, device connection/authorization, successful native compile, actual install/update, and real-device microphone/GPS behavior need a current record. Keep the existing application identity and device data while doing this check.

<!-- PAGE -->
# 07 / Android signing and Google Play

## What the current project proves

The repository contains a release build configuration and correct app/version identifiers. It does **not** contain a release signingConfig, a private upload keystore, a keystore alias/password, a Play Console app ID, or a verified store-release receipt. Those omissions are not permission to generate a replacement key if a working release identity already exists elsewhere. [S3]

Android Studio normally signs local Run/debug builds with a generated debug certificate. That is useful for device testing and does not establish production release signing. Google Play release signing and upload-key management are a separate workflow. [A3]

| Item | Status at this transfer |
| --- | --- |
| Android source/project package | Delivered and verified as v14.11 / 151 |
| Web export / native asset copy | Passed recorded release checks |
| Local debug APK | Build instructions provided historically; no current APK supplied by this handoff |
| Release keystore and key alias | Not verified / not included |
| Existing signing certificate fingerprints | Not recorded |
| Google Play developer account / app record | Not verified |
| Play App Signing enrollment | Not verified |
| AAB uploaded to a testing/production track | Not verified |
| Managed/private Play distribution | Not established by the available record |

## Preserve continuity when the bot takes over

Locate the owner's existing Android signing records before deciding whether anything needs creation. Record the key's secure storage location, alias and certificate fingerprints without putting the key or passwords into this PDF or GitHub. Determine whether previously installed Android builds are debug-signed or release-signed before planning an update.

If the intended distribution is Google Play, follow the existing account's signing/upload process and retain the app identity. If the current pilot is local Android Studio installation, describe it that way. Do not report a Play launch merely because the application runs on a Samsung device.

## Native acceptance still matters

Compile/install with the intended signing setup and test an update over the existing installation. Verify sign-in, map gestures, latest-knock pins, manual lead saving with the keyboard, offline recovery, microphone permissions, Android Back, background/resume and designated scheduling requests. Preserve pending work if signing or installation fails.

<!-- PAGE -->
# 08 / Firebase, Vercel and backend setup

## Existing environment already wired into the app

| Resource | Established configuration |
| --- | --- |
| GitHub repository | HappySolarCoder/happy-solar-leads |
| Production API origin | https://happy-solar-leads.vercel.app |
| Firebase project | gen-lang-client-0395385938 |
| Firestore database | (default) |
| Firebase auth domain | gen-lang-client-0395385938.firebaseapp.com |
| Expected Storage bucket | gen-lang-client-0395385938.firebasestorage.app |
| Mobile public configuration | Existing .env.local; variable inventory in mobile.env.example |
| Core server credential name | FIREBASE_SERVICE_ACCOUNT |
| Separate GHL helper credential | FIREBASE_SERVICE_ACCOUNT_JSON |

The production mobile builder validates the intended environment and bundles the web app locally. Native API transport targets the existing HTTPS origin. Firebase Auth/Firestore transport is separate. The handoff did not create a new Firebase project, database, website, or production environment. [S1, S3]

## Live route evidence from the handoff

The read-only probe at **2026-10-17 05:49 UTC** (October 16 evening in Phoenix) found:

| Route | Result / established meaning |
| --- | --- |
| /api/mobile-leads | JSON 401: route/auth boundary present |
| /api/mobile-feedback | JSON 401: route/auth boundary present |
| /api/territory-management | JSON 401: route/auth boundary present |
| /api/mobile-user-management | 404: optional route unavailable |
| /api/field-config and /api/field-work | 404: optional services unavailable; native direct knocks do not depend on them |

Earlier October 12 notes reported missing mobile-leads/feedback routes. The later probe supersedes that route-presence result. It does not identify who deployed the changes, which commit is live, or whether authenticated calls and worker capabilities succeed. [S1, S2]

## What is not established

The current Vercel owner/team, production commit, environment-variable values, deployed Firebase rules/indexes, service-account IAM and actual bills were not inspected. The transfer changes documentation/source access, not the production deployment. Keep mobile packaging separate from the website/backend deployment workflow.

<!-- PAGE -->
# 09 / Integrations and service setup

| Integration | Work completed / configured | Remaining confirmation |
| --- | --- | --- |
| Firebase sign-in | Native persistence, bounded startup/retry, shared session/profile flow | Current user roles, approvals and device/session acceptance |
| Direct native knocks | Account-scoped durable drafts, original actor/time, deferred GPS, create-once/idempotent replay | One approved live action/readback per platform |
| Homeowner database | Existing read-only collection, corrected coordinates, bounded geohash reads and cache | Actual deployed access policy and field performance |
| Scheduling Manager | Existing admin-settings webhook, payload preserved, native HTTPS, lead-sync-before-send | Real receiving service gets the designated request once |
| GHL outcomes | Separate appointment feedback fields/badges and manager/admin sync action | Live upstream sync cadence, data freshness and account access |
| Territory management | Boundary tools, paged assignment, history-preserving deletion | Authenticated server capabilities and role enforcement |
| Background assignment | Cloud Tasks companion, persisted cursor, bounded batches, retry state | Queue exists, IAM/secret configured, tasks complete with app closed |
| Voice feedback | Local recording/retry, private Storage API, owner/admin access design | Real bucket permissions, microphone and signed playback |
| Dictation | Android integration and registered iOS RaydarDictation plugin | Actual speech permissions/capture and fallback on devices |
| Business cards | Link to Bloom's business-card tool | No native sending, tracked-open event store or Radar alerts built |

## Background-task configuration already specified

The companion expects server-only `TERRITORY_TASK_QUEUE` and `TERRITORY_TASK_SECRET`, with queue ownership in the existing Firebase/GCP project. The reference region is us-central1 and queue name raydar-territories. The worker persists progress, processes bounded 200-record pages, and enqueues continuation. These are implemented design/configuration instructions; this record does not claim the queue was created or successfully exercised. [S7]

## Accounts and costs

Scheduling and GHL use existing company integrations; this transfer does not establish ownership of those external accounts. No new paid AI transcription, map provider, push-notification service, or business-card messaging subscription was added. Existing Firebase, map/geocoding, cloud-task and Storage usage can still have costs. Actual billing and quotas need the owner's cloud records. [S1, S4, S7]

<!-- PAGE -->
# 10 / App functionality already delivered

## Rep workflow

- Today: personal activity, follow-ups and entry to knocking.
- Knock: street/satellite map, location dot/GPS controls, compass, filters, homeowner layer, worked pins, lead detail and manual pins.
- Quick actions and forms: configured dispositions, NH/NI/CSM controls, go-backs, notes and existing scheduling flow.
- Follow-ups: personal reminder scope, search/filter and explicit bulk reminder cleanup without deleting lead history.
- Progress: personal period metrics and a scroll/safe-area layout compatible with the bottom navigation.
- Field tools: existing business-card link, dictation/notes and recovery-related tools; role-gated management access.

## Reliability and data integrity

- Durable, account-scoped pending work survives reload/reconnect; original action timestamps and actor attribution are preserved.
- Pending GPS is tied to the original action window and proximity rules; a later location does not falsely verify an old knock.
- Retried/lost-acknowledgement saves are idempotent; delayed older knocks do not roll newer status/GPS backward.
- Worked/homeowner reads are bounded and cached. Role/territory scope remains part of the design.
- Combined house history is display-only. Original lead/visit records and explicit ownership actions remain intact.
- Recoverable startup/error and unsynced states replace silent failure where implemented.

## Most recent tester fixes: v14.10 and v14.11

| Report / request | Delivered response |
| --- | --- |
| Past knocks show wrong pin | Compare event times across personal/viewport/cache records and derive newest configured result |
| More than one pin per house | Group connected loaded house records while preserving distinct street numbers and raw histories |
| Pins flash/disappear | Retain known in-scope records during pending/partial/failed refresh; reuse house markers and corrected anchors |
| Dense areas incomplete | Explicit Load more pins continues the bounded cursor |
| Manual Add Lead cannot reach Save | Top-layer dialog, visualViewport-aware height, scrolling fields and fixed footer |
| Manual pin touch flow | Long press with movement/pinch cancellation and durable create-once save |

## Discussed, not delivered

Walking-camera auto-follow, two-finger map rotation/roof inspection, and native business-card sending with tracked opens/alerts remain future features. The live location dot and existing compass do not mean map-follow or map-rotation is implemented. [S4, S6]

<!-- PAGE -->
# 11 / Verification already completed

## Latest release evidence

The recorded v14.11 checks passed on October 15. These were source/export and synthetic browser checks, with fictional adapters and blocked external traffic for UI tests. This PDF did not rerun application tests because the new changes are documentation only. [S6]

| Check | Completed evidence / scope |
| --- | --- |
| Mobile regression suite | 146 tests passed serially with concurrency 1 |
| Spatial matching workload | 10,000 leads / 1,500 homeowners; about 487 ms in the recorded serial run |
| Mobile browser sizes | Chromium at 393x852 and 360x640 |
| House pin/history | Four visit records grouped to one pin; eight history entries; latest outcome and layer-off checks |
| Refresh stability | Retention through partial/failed pages; marker reuse; continuation cursor |
| Keyboard/form simulation | Visible heights 320/260 px and offset up to 35 px; final field scroll and Save accessibility |
| Manual create contract | One synthetic saved record with original timestamp, actor and GPS behavior |
| Production web export | TypeScript/static export passed with configured production environment |
| Native packaging | Both platform assets generated; Capacitor sync and copied-bundle version checks passed |
| Release archives | Both original ZIP integrity checks and SHA-256 checks matched |
| GitHub transfer | Published source tree matched the verified local tree; documentation-only diff checked |

## Important limits carried forward

An existing one-second performance assertion failed under parallel contention, then passed in the full serial run without weakening the threshold. The reviewed legacy map/page files still have 27 lint errors; the project is not represented as lint-clean.

Earlier simulator/native logs demonstrate that the iPhone workflow was exercised historically. They do not certify v14.11 compilation, signed archives, real iPhone/Samsung behavior, heat/battery, live webhook delivery, store processing or an approved beta.

## Current acceptance record

Use the existing `ACCEPTANCE-CHECKLIST.md` to record platform/OS, source SHA, version/build, backend deployment, expected/actual outcome and evidence. Test the newest pin/manual-form changes, offline replay, GPS denials, microphone, account switching, scheduling and territory completion with approved records. Preserve pending device work while investigating failures.

<!-- PAGE -->
# 12 / Commands, files and access to retain

## Open the latest package in Xcode

After placing the original iOS ZIP in Downloads, use a fresh destination or preserve existing local edits/configuration before extracting:

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.11-ios.zip" \
  "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.11-ios" &&
bash scripts/mobile/install-ios.sh xcode
```

For Android, use `raydar-v14.11-android.zip`, its matching `...v14.11-android` folder, then `bash scripts/mobile/install-android.sh`. From either source checkout, the installer is the reproducible entry point; select the correct current folder rather than an old IDE recent-project entry.

## Source and checks already available

Repository: [HappySolarCoder/happy-solar-leads](https://github.com/HappySolarCoder/happy-solar-leads). Handoff branch: `codex/raydar-grok-handoff-v14-11`. Release branch: `codex/raydar-mobile-v14-11-pin-stability`.

Runtime release commit: `337461c2a4fd2a66d4c624be1da5c4959fa242a5`. Original package commit: `04720636f9f37f73f98cacddd3b1b9974cc5388c`. They have the same source tree, `e2080c9d3dd9c64932b8e3611c199b9f5d1adf8a`. Later handoff commits add documentation.

```bash
node --import tsx --test --test-concurrency=1 tests/mobile/*.test.ts
npm run mobile:check-backend
npm run mobile:build
npx --no-install cap sync
node scripts/mobile/check-bundle.mjs out
```

## Setup details the receiving bot should record once

| Existing resource to locate | Non-secret detail still needed |
| --- | --- |
| Apple Developer / Xcode | Legal team name, Team ID, membership state, selected signing team |
| Raydar Canvassing record | Numeric Apple ID, actual SKU, latest uploaded/processed build and status |
| TestFlight group | Exact group name, assigned build, review state, approved distribution link |
| Android workstation / signing | Installed Studio/JVM/SDK, latest successful run, key location/alias/fingerprints |
| Google Play, if already used | Owner, package/app record, signing enrollment, test track and last uploaded version |
| Vercel / Firebase / GHL | Responsible owner, environment/deployment identifiers and secure access process |

Record references and owners, not passwords, private keys, service-account JSON or tokens. The new bot should reuse existing accounts and identities before creating replacements.

<!-- PAGE -->
# 13 / Evidence and source register

## Project and historical records

All repository paths below are relative to HappySolarCoder/happy-solar-leads. Code references are from the inspected v14.11 tree. Prior notes are used for history, with current source taking precedence for version/configuration.

| Reference | Evidence used |
| --- | --- |
| S1 | docs/handoff/v14.11/HANDOFF.md, RELEASE-MANIFEST.json and prior completed transfer; exact release identities, October 17 UTC route probe and package verification |
| S2 | docs/mobile-next/IPHONE-V14.3.md, FIELD-V14.8.md; saved raydar-v14.8-testing-and-bot-guide.md. Xcode/simulator record, Apple workflow and later existing Raydar Canvassing / tester-group references |
| S3 | capacitor.config.ts; ios/App/App.xcodeproj/project.pbxproj; ios/App/App/Info.plist; android/app/build.gradle; android/variables.gradle; scripts/mobile/install-ios.sh and install-android.sh |
| S4 | docs/mobile-next/BRAND-V5.md; FIELD-V6/V8/V10/V11.md; HOMEOWNERS-V12.md; FIELD-V12.6/V13/V14.5/V14.8.md; RELEASE-V14.9/V14.10/V14.11.md |
| S5 | docs/mobile-next/IPHONE-V14.4.md and its earlier native-log analysis; simulator evidence remains historical, not a new device test |
| S6 | docs/mobile-next/VERIFY-V14.11.md and .json, RELEASE-V14.11.md; recorded tests, browser scenarios and native packaging limits |
| S7 | docs/mobile-next/SERVER-V14.8.md and BOT-ONLY-V14.9.md; backend/queue implementation and deployment instructions |
| H1 | Retrieved earlier setup conversation around October 12 UTC: Xcode 27 / Mac mini context and user confirmation of automatic signing. Retrieval did not establish an exact Apple team, latest store build, approval or completed Play setup |

## Official distribution references

Checked October 17, 2026 UTC. These describe platform workflows; they do not establish the user's account state.

- A1: Apple, [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/). Build lifetime and internal/external tester distinction.
- A2: Apple, [Invite external testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/). Beta-review and distribution status.
- A3: Android Developers, [Sign your app](https://developer.android.com/studio/publish/app-signing). Debug signing, release signing and Play upload keys.

## How to update this record

When the owner or receiving bot opens the existing accounts/Mac, add exact observed values and dates to the unresolved items. Change a status only when there is a user confirmation, account record, command result, upload receipt or device test. Preserve the distinction between completed source work, historic setup and current live acceptance.

The delivered technical handoff plus this completion/setup record provide the continuity package. Future work should retain those documents and update the release identity, tests and operating notes with each actual app release.
