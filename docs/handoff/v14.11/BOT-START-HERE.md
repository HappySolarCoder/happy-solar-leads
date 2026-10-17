# Start here: Raydar takeover

You are taking over Happy Solar's existing **Raydar** mobile app. The owner last identified 14.10 in the earlier conversation; the completed bug-fix release supplied for transfer is **14.11 / build 151**. Start from the code and evidence in this package, preserving any newer owner work.

Repository: https://github.com/HappySolarCoder/happy-solar-leads

Takeover branch: `codex/raydar-grok-handoff-v14-11`

Runtime baseline: `337461c2a4fd2a66d4c624be1da5c4959fa242a5` on `codex/raydar-mobile-v14-11-pin-stability`.

## First actions

1. Read `HANDOFF.md` and `RELEASE-MANIFEST.json` in this folder. Review the release and verification notes under `docs/mobile-next`.
2. Inspect `git status`, current branch and source identity. Do not overwrite newer local work or start a new app from scratch.
3. Use Node 22+ and the lockfile. Run `npm ci` and `node --import tsx --test --test-concurrency=1 tests/mobile/*.test.ts`.
4. Obtain the existing `.env.local` configuration securely. It is intentionally excluded. Use `mobile.env.example` as the variable inventory; do not invent another Firebase project or app ID.
5. Run `npm run mobile:check-backend`. Required routes returned JSON 401 during handoff; optional field/user routes returned 404. That probe does not prove authenticated operation.
6. On the Mac, open Xcode with `bash scripts/mobile/install-ios.sh xcode`. Android uses `bash scripts/mobile/install-android.sh`. These rebuild and sync the configured web assets.
7. Complete `ACCEPTANCE-CHECKLIST.md` on physical devices and approved test records before wider distribution. Report what passed, failed or remains untested with exact commit/version/environment references.

## Preserve these contracts

- One displayed house pin, using the newest known loaded knock; preserve every original visit/history document. Never bulk-delete duplicate-looking leads or write the aggregated display history back to a lead.
- Keep known in-scope pins through partial/failed refresh, retain corrected rooftop anchors, and preserve resumable Load more pins behavior.
- Keep the manual-lead dialog footer reachable with the native keyboard open.
- Capture original action time and actor before asynchronous GPS. Preserve Firestore Timestamp types, idempotent replay, account-scoped drafts, pending GPS limits, and acknowledged-write overlays.
- Preserve role/territory limits, proximity rules and explicit ownership actions. A disposition change must not silently transfer ownership.
- Preserve Scheduling Manager payload/delivery semantics and keep GHL appointment outcomes separate from door-knock status.
- Never clear device storage or uninstall while work is pending. Never run legacy reset/generate/setup scripts against live records.
- Mobile app packaging and website/backend deployment are separate. Do not deploy the mobile frontend as the company website or merge this whole mobile branch into production/main.

## Current product and technical baseline

Next.js/React static mobile export, Capacitor 8 native containers, Leaflet map, Firebase Auth/Firestore, existing HTTPS API. App identity is `com.happyslr.raydar.next`; Android namespace is intentionally `com.happyslr.raydar`. Production API is `https://happy-solar-leads.vercel.app`; Firebase project is `gen-lang-client-0395385938`.

Native ordinary knocks use the direct durable write/outbox path. Missing optional `/api/field-work` or `/api/field-config` routes are not a reason to switch this architecture. The separate background territory worker still requires authenticated capability/infrastructure verification.

## What has and has not been established

The release record contains 146 passing serial tests, synthetic Chromium mobile/keyboard/pin scenarios, production static export, native asset generation, Capacitor sync and bundle checks. A parallel timing assertion failed under contention; serial verification passed without relaxing it. Existing lint debt remains. Physical native compilation, signing, TestFlight/Play upload, real-device GPS/keyboard/dictation, authenticated production data and live third-party/queue behavior were not verified here.

Three ideas remain future work: walking-camera follow, two-finger map rotation/roof inspection, and business-card sending with tracked opens/Radar alerts. Current business cards link to the external Bloom application, whose source is not included. Scope these separately with the owner after verifying the baseline.

## First response to the owner

State which commit/build you have, what you successfully opened/tested, which credentials or account access are genuinely missing, and the next concrete acceptance check. Do not claim to know unseen prior chats. Use this manual and the checked-in release evidence as the transfer record.
