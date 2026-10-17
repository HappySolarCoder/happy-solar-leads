# Raydar engineer handoff

Expanded answers from the original Raydar App chat

**Raydar Next | v14.11 | native build 151**

Prepared October 17, 2026, America/Phoenix. This supplements the existing v14.11 package and answers the owner's ten transfer questions. It incorporates the original shared **Raydar App** conversation, including relevant setup screenshots, plus the inspected release source and handoff records.

## What the reference chat resolved

| Topic | Newly recovered evidence |
| --- | --- |
| Mac toolchain | User's Terminal output: Xcode 27.0, build 27A266a; Node v24.18.0; npm 11.16.0 |
| Working Mac folder | Original project under /Users/evanday/Downloads/happy-solar-leads-codex-native-mobile-app; later versioned Downloads folders also appear in Terminal logs |
| Apple record | Screenshot confirms Raydar Canvassing at App Store Connect app ID 6821782902 |
| TestFlight history | October 12 screenshot shows 14.9 / 149, Ready to Submit, group HS; it does not establish build 151's status |
| Physical devices | Owner confirmed a working Galaxy S25 install; later reported iPhone SE on iOS 26.6.1 during stability testing |
| Backend deployment | Owner relayed the bot's v14.8 production-deployment report; authenticated workflows remained unproven |
| Field feedback | Original reports establish overheating, white screens, GPS and territory failures, pin problems, and slow assignment |

## Evidence rules

**Confirmed in history** means a user statement, pasted output or screenshot establishes a past fact. **Source verified** means code or release evidence establishes implementation. **Reported fix** means a change was delivered; it does not prove field acceptance. **Unknown** means the available evidence does not settle the question.

The shared chat ends with v14.10 / build 150. It cannot establish the later build 151 archive or upload. The current conversation and v14.11 release records supply that later development context. Historical software versions, review states and deployment reports are not presented as current live account inspections.

No passwords, API keys, tokens, signing material, raw logs or private screenshots are included. No application, cloud or Apple settings were changed to prepare this document.

<!-- PAGE -->
# 1 / Build 151 provenance

## Exact archive folder or commit

**Unknown.** Neither the shared chat nor the available release records identify the exact Mac checkout, working-tree state or Xcode archive used for the owner's build 151 upload. The original chat ends at v14.10. There is no build 151 Organizer record, archive metadata or upload log in the reviewed evidence. [R1, S1]

What is established is the source provenance of the delivered v14.11 project packages:

| Identity | Exact value |
| --- | --- |
| GitHub application release | 337461c2a4fd2a66d4c624be1da5c4959fa242a5 |
| Local package-source commit | 04720636f9f37f73f98cacddd3b1b9974cc5388c |
| Identical tracked-source tree | e2080c9d3dd9c64932b8e3611c199b9f5d1adf8a |
| Release branch | codex/raydar-mobile-v14-11-pin-stability |
| Handoff branch | codex/raydar-grok-handoff-v14-11 |
| Version / build | 14.11 / 151 |
| Bundled web assets built at | 2026-10-15T17:57:43.544Z |

The two commit IDs describe the same application source tree. GitHub publication used a separate commit history. This does **not** establish which copy the owner selected in Xcode. In the manifest, archiveSourceCommit refers to source used for the delivered ZIP packages; it is not proof of a signed Xcode .xcarchive. [S1]

## Mac folder and local-only changes

The instructed v14.11 iOS folder was:

`~/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.11-ios`

The exact folder actually archived remains **unknown**. The installation script can rebuild web assets using the local configuration and sync them into iOS before Xcode opens.

Whether that Mac had changes outside git is **unknown**. The packages intentionally exclude `.env.local` and private signing material. The user selected automatic signing locally in earlier work; no later git diff was supplied. Therefore, do not assume the Mac working tree, local configuration or signed archive was identical merely because the release sources match.

## What the engineer can rely on

The delivered ZIPs are source projects with prepared web assets, not signed IPA or APK files. The release passed 146 serial mobile tests, configured export and native bundle sync/checks. Native compilation, physical-device acceptance and store upload were not executed in those release checks. The original platform ZIP checksums remain in RELEASE-MANIFEST.json and SHA256SUMS.txt. [S1, S2]

<!-- PAGE -->
# 2 / Mac mini setup

| Item | Known record and limits |
| --- | --- |
| Xcode | User pasted Xcode 27.0, build 27A266a. Repeated in the v14.1 simulator install output. Current installed version is unknown. |
| Node / npm | October 8 output: Node v24.18.0 and npm 11.16.0. Current versions are unknown. The release installer minimum is Node 22+. |
| Developer directory | Initially /Library/Developer/CommandLineTools. Instructions switched to /Applications/Xcode.app/Contents/Developer; subsequent xcodebuild output confirmed Xcode worked. |
| Mac account / host | Terminal shows user evanday. Earlier host label Evans-Mac-mini-2; later Evans-Mac-mini-3. These are historical prompts, not a verified network address. |
| Original working project | /Users/evanday/Downloads/happy-solar-leads-codex-native-mobile-app. A successful later prompt is inside this folder. |
| Later project copies | Versioned folders under /Users/evanday/Downloads, including v7 and v14.1, are shown in actual Terminal output. The current canonical repo folder is unknown. |
| iOS simulator | User's log selects iPhone 17 on iOS 27.0. Device Hub was needed on this Xcode installation; an older Simulator launcher path failed. |
| Xcode account/team display | User said: "It shows Evan Day Admin." Later instructions selected Evan Day, and the user confirmed automatic signing was done. Exact signed-archive team and 10-character Team ID remain unknown. |
| Android Studio | Installed/opened and used for a confirmed Galaxy S25 Run installation. Exact Studio version is unknown. |
| Android SDK | Setup path was /Users/evanday/Library/Android/sdk; a later adb command from that location worked. JVM 21 and SDK 36 are the app's documented tooling requirements. |
| Remote connection | Unknown. No verified SSH, Screen Sharing, remote-desktop service, hostname, VPN route or connection procedure appears in the reviewed chat. |

Sources: October 8 setup messages and October 11 simulator/ADB output in Raydar App; native installer guides. [R1, S3]

## Setup problems worth preserving

The owner once entered a folder path without `cd`, then ran `npm ci` from the home directory. Later commands used `cd ... && ...` to stop on a wrong folder. A missing Android SDK directory was initially created empty; the SDK still needed installation. An emulator download later failed with **No space left on device**. Neither issue proves a phone-connection fault.

Downloads cleanup also removed earlier project/configuration copies. The v14.1 installer explicitly reported a missing `.env.local`; configuration had to be restored. Keep the working configuration and versioned source available through the existing secure transfer process. Do not substitute a historical hostname for a tested remote-access route.

<!-- PAGE -->
# 3 / Apple and TestFlight

| Question | Answer from the available evidence |
| --- | --- |
| Apple Team ID | **Unknown.** The team UUID visible in an App Store Connect URL is not evidence of the 10-character Developer Team ID. |
| Team name / role | Xcode account screen was reported as Evan Day Admin. Automatic signing was explicitly confirmed. This does not establish the complete ASC role roster or the team used for build 151. |
| ASC app ID | **6821782902**, confirmed in the URL of the October 11, 7:18:42 PM screenshot. The displayed app is **Raydar Canvassing**. |
| Native bundle ID | **com.happyslr.raydar.next**, verified in release source and used throughout installation/upload instructions. The reviewed ASC screenshot does not display its bundle-ID field. |
| SKU | **Unknown.** raydar-next and raydar-next-ios appeared as proposed setup values in earlier material; no saved SKU was shown. |
| ASC access roles | **Unknown.** The owner says the incoming engineer already has ASC access. Invitation acceptance, role name, app scope and certificate access are not established here. |
| External group | **HS** appears beside build 149 in the October 12 screenshot. Chat instructions refer to HS under External Testing. |
| Last observed review state | **14.9 / 149: Ready to Submit**, October 12 at 3:55 AM. A 14.7 version section is also visible. No later approval or build 151 review state is established. |
| What to Test | Exact saved build notes are **unknown**. Instructions said to add testing notes; no submitted text is visible. |
| Beta description | October 12 review-information screenshot shows **Raydar Beta Test**. This is the beta app description, not proof of What to Test notes. |
| Feedback email | The same screenshot shows **evan@happyslr.com**. Whether it remains the current value is unknown. |

## Export compliance and reviewer access

The October 11 encryption screenshot shows the unanswered questionnaire. The recorded advice for v14.5 was to select **None of the algorithms mentioned above**, based on the app's use of operating-system secure networking. The screenshot itself has no option selected; actual saved answers, later questionnaires and build 151 compliance status are **unknown**. This records historical advice, not a fresh compliance determination. [R1]

The October 12 contact form contained Steven's contact details and an empty required phone field. The advice was to use the owner's review contact details unless Steven would handle review, and provide a **dedicated Raydar review account**, separate from the owner's admin login or Apple ID. Creation, permissions, credentials, usable test territory and successful reviewer access are **unknown**.

The chat records manual Xcode archive/upload instructions, not an automated TestFlight pipeline. A GitHub push did not upload a build. Do not interpret a historical upload instruction or tester invitation request as proof of external approval. [R1]

<!-- PAGE -->
# 4-5 / Android and test accounts

## 4. Android distribution

| Question | Known answer |
| --- | --- |
| Release keystore exists? | **Unknown.** No release keystore or verified storage location was provided. The inspected Android project has no established release signing configuration. |
| Keystore location | **Unknown.** No guessed default path is asserted as a real release key. |
| Play Console app | **Unknown.** At the start, the owner said they did not have developer accounts and wanted internal distribution. No subsequent Play app creation is shown. |
| Confirmed install method | Android Studio Run over USB to the owner's Galaxy S25. The owner replied **It works!** during the original setup. |
| Only ever debug-signed? | **Unknown as an exhaustive history.** Confirmed workflow is debug/testing; no release-signing evidence was found. |
| Other distribution discussed | v14.5 instructions used `assembleDebug` to produce a test APK for direct sharing. Execution or distribution of that APK was not confirmed. |

The proposed v14.5 APK output was `~/Desktop/Raydar-v14.5-Android-Test.apk`, copied from `android/app/build/outputs/apk/debug/app-debug.apk`. This is a **documented output path**, not a confirmed existing file or release keystore. A permanent release signing key was proposed for ongoing distribution; completion is unknown. [R1, S3]

## 5. Accounts, territory and leads safe for testing

**Approved live setter, manager and admin test accounts: unknown.** The owner tested an admin account, but that does not make it a disposable test identity. Steven is an intended tester; his app role, UID and approved test access are not established.

**Designated test territory and disposable test leads: unknown.** The code's fictional fixture accounts are not real logins. No production lead or territory is designated safe to alter in the reviewed record.

The shared chat mentions a specific Irondequoit homeowner record for a **read-only coordinate diagnostic**. That does not authorize test knocks, changes or deletion on that homeowner's record. Existing test instructions call for a designated test lead but do not supply an approved ID.

Both the simulator and installed native app connect to the live Firebase project. Saving a disposition, changing a territory or sending a scheduling request can affect real company records. A receiving engineer needs an owner-approved account/record inventory before running write-based acceptance checks. This document supplies no credentials.

## Known device-side configuration

Application ID remains **com.happyslr.raydar.next** on both platforms. Android namespace remains **com.happyslr.raydar**. Preserve the app ID and installed signing identity when producing updates so existing device data and queued work remain reachable. [S1, S3]

<!-- PAGE -->
# 6 / Bugs: pins and saving

This is the complete inventory of relevant reports recovered from the reviewed conversations and release notes, not a claim that every TestFlight feedback record or field incident was available. Unless explicitly stated, physical-device closure in v14.11 is **unknown**. A code fix is not field acceptance. [R1, R2, S2, S4]

| Report | Delivered response | Status at v14.11 handoff |
| --- | --- | --- |
| House shows an older knock or wrong latest result | v14.10 grouping; v14.11 timestamp/history reconciliation across personal, viewport and saved snapshots | Patched and tested in isolation. Latest result is limited to records actually loaded; dense views may need Load more pins. |
| Several old knock pins on one roof; homeowner info/history should combine | v14.10 display grouping; stronger v14.11 matching, order independence and homeowner-row collapse | Patched; field closure unknown. Grouping does not delete or rewrite historical lead documents. |
| Pins flash, appear and disappear | v14.11 retains in-scope pins through partial/delayed/failed refreshes and reuses house markers | Browser observer found no missing/duplicate frames in covered cases. Real-device weak-network acceptance remains open. |
| iPhone hold-to-add manual pin fails; Android works | v14.10 touch long-press and manual-save changes | Browser touch checks passed, including v14.11 regressions. Physical iPhone confirmation unknown. |
| Manual Add New Lead form cannot scroll far enough to Save | v14.11 viewport-aware dialog, independent fields scroll and persistent footer | Passed simulated keyboard/viewport tests at small phone sizes. Physical iOS/Android keyboard check outstanding. |
| Worked pins too small at house zoom | v14.7 increase; v14.9 icons two zoom levels earlier; v14.10 doubles worked-pin artwork | Source changes delivered. Final field acceptance unknown; homeowner circles remain a separate sizing decision. |
| Normal save displays alarming Firestore / unsynced messages | v14.7-v14.9 quiet routine saves and immediate provisional pin state | Implemented. Actual failed/blocked drafts must remain visible and recoverable. |
| Disposition panel stays open; brief GPS delay blocks flow | v14.9 closes after durable local save and completes GPS in background | Implemented with retry/recovery. CSM retains its confirmation/call flow. End-to-end phone proof remains incomplete. |

## Exact latest-pin limit

The intended rule is **one displayed pin per house, showing the newest knock**. v14.11 improves that projection while retaining bounded reads. Automatic viewport loading is two pages; Load more resumes the cursor. The app cannot prove the globally newest historical record without having received it. Neighboring roofs must not be merged merely because coordinates are close. [S2]

<!-- PAGE -->
# 6 / Bugs: territories, GPS, voice

| Report | Delivered response | Status at v14.11 handoff |
| --- | --- | --- |
| Territory limited to 400 available pins / neighborhood-sized area | v14.6-v14.8 paged companion; v14.9 background assignment design | Mobile and server source delivered. Deployed background capability and queue execution remain unknown. |
| Territory preview scans thousands of pins; Save stays gray on Saving | v14.9 saves boundary and queues resumable pin assignment | Requires backend/queue setup. No proof that processing finishes with the app closed. |
| Delete all territories errors or still fails after prior update | v14.5 uses supported per-territory archive action; v14.6 improves progress/retry | Source patches tested; the exact field failure was not fully reproduced. Production closure unknown. |
| Freehand drawing falsely reports crossing lines | v14.6 and v14.8 geometry normalization/check fixes | Synthetic geometry tests passed. Physical drawing/dragging still requires acceptance. Automatic shape correction was explicitly dropped. |
| Numbered corners clutter freehand territory drawing | v14.7 presentation cleanup | Implemented; field confirmation unknown. |
| Assigned territory hard to find | v14.6 My / Team / Off overlay menu and Zoom to mine | Implemented. Not a guarantee that every live assignment is correct. |
| Second Zoom to mine says no territory, then zooms correctly | v14.8 refresh/cached-territory handling | Patched; repeat-use field closure unknown. |
| GPS recenter disabled, misplaced or not clickable | v14.8 retryable GPS control and bottom-right layout | Patched; actual permissions, location availability and repeated recenter need phone checks. |
| Start knocking / reopen does not center on user | v14.6-v14.8 location-entry and resume behavior | Implemented. Continuous walking-camera follow remains separate future scope. |
| iPhone Dictate Notes fails while Android works | v14.7 native path, then v14.8 plugin registration/bridge changes | Exact reported error: Raydar dictation plugin is not implemented on iOS. Physical dictation closure remains unknown. |
| Standard users see patchy loading or wrong geographic pin scope | v14.8 bounded viewport and territory-aware loading; v14.11 partial-result stability | Code delivered; signed-in setter/manager/admin access must still be checked against production. |

The owner reported freehand drawing worked **better** during v14.6 testing, then later reported false crossings when dragging a point. Treat that as partial improvement, not a closed bug. The record contains no complete user-by-user territory acceptance matrix. [R1, S4]

<!-- PAGE -->
# 6 / Bugs: stability and interface

| Report | Delivered response | Status at v14.11 handoff |
| --- | --- | --- |
| Repeated navigation gets slower; app freezes, white-screens and restarts | v14.8 bounded personal/viewport feeds, cleanup and recovery changes | Owner later reported quicker pins and a much smoother map. No five-hour endurance result or complete crash closure. |
| Admin account heats iPhone SE; app stops opening after reopen | Same v14.8 performance work; entire admin lead load identified as a concrete suspect | High-priority field risk. No proof that overheating was caused solely by that query or that it is fully resolved. |
| Focus lacks door-goal input; selecting 3 appointments shows 2 | v14.6 editable door goal, consistent saved selection and appointment choices 1-5 | Implemented and fixture-tested. Physical acceptance unknown. |
| Top toolbar cramped, controls mismatched | v14.6 compact search/filter controls; v14.7 alignment/account button; GPS moved | Delivered interface revisions; no final universal tester acceptance recorded. |
| Routine cached-leads / checking outcomes banner looks like an error | v14.8 quieter normal refresh | Implemented. Genuine failures still require a useful message. |
| Lead-details page scrolls sideways into empty space | v14.9 constrained width and vertical scrolling | Phone-size browser checks passed; physical closure unknown. |
| Progress content hidden behind bottom navigation | v14.5 safe-area/scroll fixes | Automated layout checks passed. |
| Follow-ups need personal scope and bulk cleanup | v14.5 personal-only view and cleanup retaining pin history | Owner later said the cleanup feature was present and good. Full permissions/end-to-end cleanup audit unknown. |

## Related unresolved items

Manage Users was requested in earlier work, but `/api/mobile-user-management` returned 404 in the handoff probe. It should not be treated as a completed production capability. Voice feedback was implemented in v14.8; private Storage upload, playback and retry permissions were explicitly still unproven in the bot report. [R1, S1]

The v14.8 review also fixed duplicate Focus controls found during development. That is a development finding, not evidence of a separate user-submitted TestFlight incident.

## Earlier incidents relevant to regression checks

Before v14.5, reports included wrong local-time greetings, Follow-ups View all doing nothing, a pin disappearing on selection, bottom-navigation overlap, blank map strips, slow launch, a user-list crash, and iPhone sign-in/data stalls. v7-v14.4 delivered fixes and diagnostics. After v14.4 the owner said **Seems like it is working now!** That is useful historical feedback, not proof of later long-session stability. [R1]

<!-- PAGE -->
# 7 / Field usage and complaints

## People and devices actually established

| Person or group | Evidence | Still unknown |
| --- | --- | --- |
| Evan / owner | Confirmed Galaxy S25 install via Android Studio; tested an admin account; later explicitly identified iPhone SE on iOS 26.6.1 | SE generation, Galaxy Android version, daily production usage and hours |
| Steven | Named recipient for a TestFlight install link; review-contact screenshot names Steven Emerson | Whether he was the unnamed later tester, app role, iPhone model, iOS version, installed build and daily usage |
| Unnamed field tester | Owner relayed feedback on small worked pins, multiple pins per roof and failed iPhone long-press | Identity, exact phone/OS and complete field-testing duration |
| Manager users | Owner said at least one regular canvasser has manager-level access and may assign a very large area | Name, account ID, phone/OS and frequency |
| Team | Mixed iPhone/Android use; Arizona and New York were explicitly mentioned | Full daily-user roster and deployment coverage |

The iPhone 17 / iOS 27.0 record is a **simulator** on the Mac, not a field user's physical phone. Earlier statements that the owner did not have an iPhone are followed by later physical SE testing; the later device report supersedes the earlier limitation. [R1]

## Biggest complaints in the record

- Stability first: heat, freezing, white screens, repeated-navigation slowdown and failure to reopen on the SE.
- Pin trust: newest knock must win, one pin per house, no flashing, useful sizes and clearly visible roofs.
- Fast knocking: select a disposition, close the panel and update the pin promptly; keep routine save/GPS details quiet.
- Easy territory management: draw, adjust, assign and leave; avoid false crossing errors, long scans and indefinite Saving.
- Usable phone controls: reachable manual-lead Save, working long press, GPS recenter and iPhone dictation.

## Product context the next engineer must retain

Raydar serves door-to-door solar appointment setters, called **FMAs**. They canvass, use their script, build a relationship and generate leads for solar consultants. The owner said they usually send homeowner details through **Call Scheduling Manager**, then call that manager, who handles calendar coordination with the homeowner. Direct homeowner self-booking was not the primary operating workflow.

The owner reported smoother maps and quicker pin loading after v14.8. That improvement does not establish that ordinary users or managers are safe from the same long-session risks; those roles share mapping and loading infrastructure. [R1]

<!-- PAGE -->
# 8 / Hard-won lessons

| What broke or was found | Cause supported by evidence | Preserve this rule |
| --- | --- | --- |
| Wrong/latest pins and flashing | Older snapshots overwrote newer data; missing history times could appear new; partial refreshes exposed empty results; marker identity could change | Reconcile by valid event time, preserve stable house identity and retain in-scope pins during partial/error refreshes. Group only for display. |
| Initial iPhone login/startup stalls | Unbounded profile waits and duplicate startup reads were found; later logs showed sign-in succeeded before data stalled | Keep timeouts, readable failure/retry paths and account-change cleanup. Do not loosen Firestore rules to treat a generic timeout. |
| 130-second lead load | v14.3 log showed deadline-exceeded, successful API calls and working GPS; forced iOS long polling and an unbounded admin feed were concrete contributors/suspects | Preserve automatic transport detection and bounded feeds. Do not claim a permission error without its actual code. |
| Heat / long-session white screen | Broad admin loading and repeated processing were concrete suspects; the exact crash cause was not proven | Keep bounded reads/rendering and listener/GPS cleanup. Require real SE endurance testing before calling it closed. |
| Mobile reporting gaps | Capture could target undeployed field APIs; ordinary saves lacked a durable queue; browser-fetch scheduling could fail natively | Keep direct native Firestore writes and the established scheduling payload/native transport. |
| Roof misalignment after data cleanup | Imported coordinates changed, but device cache could retain old positions | Use corrected lat/lng/geohash; expire only the obsolete homeowner cache, preserving drafts and history. |

## Non-negotiable data invariants

Capture the original knock time and signed-in actor before waiting for GPS. Write existing disposition IDs, typed Firestore timestamps, newest-first history and the existing GPS/objection/go-back fields to `leads/{id}`. Ordinary dispositions must not change ownership. Preserve claim/unclaim as separate actions. Reporting copies this collection into `raydar_leads_v1`; changing the contract can make mobile activity disappear from dashboards. [R1, S5]

Persist account-scoped drafts before closing the panel. Retries must be idempotent. A late old event may add history but must not roll the current status backward. Never clear storage or uninstall while work remains unsynced. Never attach a new current location to an expired old knock, resurrect discarded work or replay one account's drafts under another account.

Do not automatically resend a scheduling webhook after an ambiguous response; the first request may already have arrived. A saved local knock is not yet proof of a confirmed backend write. Keep normal progress quiet while exposing actual blocked or failed work.

Firebase cost control is an explicit owner requirement. No unbounded scans, repeated full-company listeners or paid AI additions were approved as incidental fixes. The chat acknowledged that conflict-safe sync adds targeted reads; no production bill reduction was measured. Do not promise unchanged bills without evidence. [R1, S5]

<!-- PAGE -->
# 9 / Backend route inventory

Production API origin: **https://happy-solar-leads.vercel.app**. Firebase project: **gen-lang-client-0395385938**, database **(default)**. Native authentication and ordinary lead writes also use Firebase directly; the API list is not the entire data path. [S1, S5]

| Route or integration | App dependency / current evidence |
| --- | --- |
| /api/mobile-leads | Personal and viewport lead reads. Handoff probe: expected JSON 401 without credentials. |
| /api/team-areas | Territory overlays for permitted scope. Source dependency; authenticated live correctness unknown. |
| /api/territory-management | Summaries, management actions, paged/background capabilities. Probe 401 confirms route/auth boundary only. |
| /api/territory-assignment-worker | Cloud Tasks worker, not an ordinary phone request. Deployment and successful task delivery unknown. |
| /api/geocode | Address/town search and shared geocoding paths. Source dependency. |
| /api/weather | Weather for the location shown in the mobile flow. Source dependency. |
| /api/goals/me | Monthly goal retrieval used by Today and Knock. Verified current call sites; historical native logs showed successful responses. |
| /api/mobile-feedback | Recording upload, feedback list and review. Probe 401; signed-in upload/playback unknown. |
| /api/admin/sync-appointments | Manager/admin GHL outcome sync controls. Live upstream success and schedule unknown. |
| /api/debug-log | Best-effort diagnostics in shared manual-pin handling; not the canonical save path. |
| /api/mobile-user-management | Workspace user-management capability. Handoff probe returned 404. |
| /api/field-config and /api/field-work | Optional field features; probe returned 404. Ordinary native knocks use DIRECT_MOBILE_WRITES and do not depend on them. |
| Scheduling Manager webhook | Configured destination separate from the route inventory. Same established payload; native HTTPS path. Actual destination and verified delivery unknown. |

The probe snapshot was **October 17, 2026 at 05:49 UTC / October 16 at 10:49 PM Phoenix**. It was unauthenticated and made no production writes. It does not prove setter/manager/admin access, saved knocks, queue capabilities or storage permissions. [S1]

`/api/historical-territory-pins` appears in older v14.2-v14.3 logs and retained legacy code; it is not established as an active dependency of the current mobile page. Do not infer current usage from an old log alone. [R1, S5]

The goals route above supplements the earlier handoff answer's route list. Code references are `app/utils/goals.ts`, `app/mobile/page.tsx` and `app/mobile/knocking/page.tsx`.

<!-- PAGE -->
# 9 / Cloud state and integrations

## Who deploys, and what is known live

The owner uses a **Grok/backend bot** with Firebase access and passes it server-only instructions. The owner relayed its v14.8 report: backend live at the production Vercel origin; seven production checks passed; mobile routes rejected unauthenticated requests; field capture stayed off; existing web endpoints still responded. The original assistant then confirmed route/authentication responses. The report explicitly left signed-in pin loading, paged assignment, knock writes and feedback recordings unproven. The exact human deployment owner, Vercel project ownership and current deployment SHA remain **unknown**. [R1]

Installing a mobile ZIP or uploading TestFlight does not deploy Vercel. Port necessary backend changes into the current production code; do not merge the entire mobile redesign into the website. That separation was repeatedly required by the owner.

## Firestore rules, indexes and homeowner data

The exact **currently deployed rules and indexes are unknown**. The historical homeowner-access request instructed the bot to back up live rules, merge only the collection-specific block and preserve existing permissions. No successful rule-publish report is visible. The requested geohash index and 500-document limit are not proof of deployed configuration.

The owner explicitly reported that **636,967 homeowner documents were corrected in place on October 11, 2026**, retaining their IDs and collection. Corrected fields are lat, lng, geohash/geohash5; old fields include latOriginal, lngOriginal and geohashOriginal. v12.5 refreshed the homeowner cache. The correction report is historical user-provided evidence; live rooftop alignment was not independently verified. No repeated bulk cleanup is required by this handoff. [R1]

## Cloud Tasks

`raydar-territories` in `us-central1` is the documented queue recipe. Actual creation, IAM, active/paused state, deployed worker, configured limits and successful app-closed continuation are **unknown**. Source limits are 200-record pages, at most ten pages per task, a 60-second worker, and persisted continuation. Reference dispatch settings are one concurrent task, one dispatch per second and five attempts. These are design/configuration instructions, not live observations. [S6]

## GHL, scheduling and feedback

GHL outcome sync is present in source and uses separate appointment-outcome fields. Actual GHL calendar mappings, upstream sync schedule, webhook configuration owner and last successful sync are **unknown**. No automatic GHL cron was established by this work. CSM remains the principal operational booking path; verified real-phone webhook delivery is **unknown**.

Feedback design uses private Storage objects under `raydar-feedback/{uid}/...`, queued local recordings and admin review. The v14.8 bot report explicitly did not verify Storage permissions. No completed paid transcription or automatic feedback retention policy is established. [R1, S5]

<!-- PAGE -->
# 10 / Promises, plans and open scope

## Requirements recovered from the chat

- **Both platforms stay in step.** Owner requested each update in Android and iPhone, with separate packages and commands.
- **Version every delivery.** Use a different versioned filename, publish source to GitHub for takeover and always include the exact Terminal command.
- **Keep the map central.** Roofs and neighborhoods must remain visible; preserve Map / Satellite switching and distinct outcome information.
- **Keep CSM primary.** Preserve the scheduling-manager handoff and call flow. Live self-booking and automated messaging were gated pending configuration.
- **Focus goals.** Editable door goal; appointment choices 1-5; chosen, saved and displayed values must agree. Preserve local-day/account behavior.
- **Areas and filters.** My / Team / Off with repeatable Zoom to mine; compact search; last-knocked date plus disposition filters replacing Solar Score filtering.
- **Location entry.** Center on a fresh entry/reopen without requiring users to find themselves manually. This is distinct from continuous walking-camera follow.
- **Costs and infrastructure.** Avoid added cloud costs where possible, measure tradeoffs, use no paid AI service for now and keep mobile delivery separate from web deployment.

Most are reflected somewhere in source or release notes; the main HANDOFF.md does not spell out every interaction or the chronology of these requirements. This expanded record preserves them for takeover. [R1, S4]

## Future work already identified

Continuous walking-camera follow, two-finger map rotation/roof inspection, and native business-card sending with attributed link-open alerts remain **future scope** in the v14.11 manifest. Current business-card support is the Tools link to the owner's Bloom creator. No tracking notification system was delivered. [R2, S1]

Permanent internal iOS distribution beyond the testing phase and automated TestFlight build/upload were discussed as later decisions. Neither has a completed setup in the reviewed record. iPad support is enabled in the project, but the chat explicitly left iPad layout acceptance untested.

The earlier field-tools brief led to implemented/gated tools. The owner explicitly rejected paid AI for now and emphasized the FMA workflow. Do not treat every brainstormed feature as a promise or activate undeployed field APIs merely because their UI/source exists.

## What was not promised or established

Committed dates, a launch SLA, a complete daily-user roster, a production testing sign-off, confirmed queue deployment and build 151 approval are **unknown**. The user's desire for territory assignment in roughly ten seconds was a UX target, not measured production performance.

<!-- PAGE -->
# Evidence and final open items

## Source map

| Ref | Reviewed source |
| --- | --- |
| R1 | Original Raydar App shared chat, accessed October 17, 2026. Starts October 7; ends with v14.10 and simulator-keyboard help. Includes user confirmations, pasted logs, October 11 ASC screenshots and October 12 build/review screenshots. |
| R2 | Current transfer conversation: v14.11 bug reports, build 151 identity, ten engineer questions and requested reference-chat/PDF update. |
| S1 | docs/handoff/v14.11/RELEASE-MANIFEST.json and HANDOFF.md; original release packages and source provenance verified during transfer. |
| S2 | docs/mobile-next/RELEASE-V14.11.md, VERIFY-V14.11.md and VERIFY-V14.11.json. |
| S3 | iPhone and Android installer scripts, native project settings and iPhone setup/review guides. |
| S4 | FIELD/REVIEW notes for v14.5-v14.8; RELEASE/VERIFY notes for v14.9-v14.10. |
| S5 | Current mobile and shared source: lead feeds, house grouping, outbox, GPS, goals, scheduling, GHL sync and feedback. |
| S6 | docs/mobile-next/BOT-ONLY-V14.9.md and territory worker/queue source. |

[Open the original Raydar App reference chat](https://chatgpt.com/share/6ad319b7-c004-83e8-a96a-a17a4e9b719d)

[Open the GitHub handoff folder](https://github.com/HappySolarCoder/happy-solar-leads/tree/codex/raydar-grok-handoff-v14-11/docs/handoff/v14.11)

## Remaining facts to obtain during takeover

1. Build 151 archive metadata, source folder, commit and Mac working-tree/configuration changes.
2. Developer Team ID, actual SKU, current ASC roles, build 151 review/compliance state and saved What to Test notes.
3. Working remote-access procedure and current canonical Mac checkout.
4. Release keystore location or confirmation none exists; Play Console state.
5. Explicitly approved test accounts, lead IDs and territory; reviewer account readiness.
6. Current deployed rules/indexes, worker/queue configuration and authenticated integration results.
7. Real-device acceptance on SE and current field phones, including endurance, keyboard, voice, offline sync and scheduling.

These items are intentionally marked unknown in the answers. Their absence is not a claim that the work was never done.

## Open the delivered iOS project in Xcode

With the existing v14.11 iOS ZIP in Downloads:

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.11-ios.zip" \
  "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.11-ios" &&
bash scripts/mobile/install-ios.sh xcode
```

