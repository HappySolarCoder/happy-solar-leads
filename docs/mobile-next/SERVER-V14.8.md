# Raydar v14.8 backend companion

Prepared for the existing `https://happy-solar-leads.vercel.app` project. This companion has NOT been deployed by this release. Uploading build 148 to TestFlight does not deploy these routes.

The unauthenticated production check on October 12, 2026 returned:

| Route | Observed result |
|---|---|
| `/api/mobile-leads` | HTTP 404 — missing |
| `/api/mobile-feedback` | HTTP 404 — missing |
| `/api/territory-management` | Expected JSON HTTP 401 — route exists; this does not prove paged capabilities |
| `/api/mobile-user-management`, `/api/field-config`, `/api/field-work` | HTTP 404 — optional; native knocks do not use these |

**Deploy and validate this companion before distributing v14.8.** Existing installed builds continue using their existing endpoints. Do not merge the full mobile branch into production.

## Exact bot handoff

Give your bot the server-companion ZIP and this instruction:

> Update the backend of HappySolarCoder/happy-solar-leads for Raydar mobile v14.8. Work from current main in an isolated branch. Apply only the companion's SERVER-FILES.txt paths, preserving unrelated newer changes. Do not merge the full mobile source branch or deploy its frontend. Keep the existing production Vercel project, Firebase project gen-lang-client-0395385938, and (default) database. No Firestore rules/index changes, migrations, bulk reads/backfills, or homeowners writes.
>
> The companion includes the previously undeployed v14.7 paged territory backend, a read-only mobile-leads endpoint, an authenticated private voice-feedback endpoint, and lightweight team-area summaries. Check the new helper imports against current main. `firebase-admin.ts` must export adminAuth, adminDb and getAdminApp. `types/disposition.ts` must export isScheduledGoBackLead; the source release already has it. No new npm dependency is needed.
>
> Run the normal production build/type checks, and the mobile source branch's isolated mobile tests. Resolve incompatibilities without replacing the site's frontend. Use a preview deployment for authenticated checks, then deploy ONLY this backend companion to the existing production project. Verify the route and capability checks below and report the commit, deployment URL, and each result. Do not call a 401 probe a complete integration test. Do not test by modifying existing real leads without Evan's selected test records/account.

## Server files

```
app/api/mobile-leads/route.ts
app/api/mobile-feedback/route.ts
app/api/team-areas/route.ts
app/utils/server/mobileLeads.ts
app/utils/server/mobileFeedback.ts
app/utils/server/territoryManagement.ts
app/utils/server/territoryManagementV2.ts
app/utils/territoryManager.ts
app/mobile/_lib/followUps.ts
```

The current `/api/territory-management/route.ts` already calls createTerritoryHandlers; retain it. Keep old territory actions working alongside preview-v2, begin-assignment and continue-assignment. Archived territory deletion preserves lead/pin history. Large assignment remains resumable and rechecks ownership and eligibility every batch (200 documents/request); do not silently turn it into an unbounded transaction.

## Configuration and Storage

Use the existing server-only FIREBASE_SERVICE_ACCOUNT for the production Firebase project. Never put it in a mobile ZIP or NEXT_PUBLIC variable. `FIREBASE_STORAGE_BUCKET`, if set, must be `gen-lang-client-0395385938.firebasestorage.app`; that is also the route's default.

Feedback writes only private objects under `raydar-feedback/{uid}/...` in that bucket. It does not introduce a Firestore collection. The server service account needs object create/list/read and signed-URL capability for this feature. Validate its existing permissions; if access is missing, grant only the needed access to this prefix. Do not make the bucket public or loosen client Storage/Firestore rules. Owners can retrieve their own feedback; only admins can retrieve all. Review links expire after 15 minutes. Audio is stored for later manual/bot transcription; no paid AI service is called. No automatic retention deletion is configured.

Recordings are at most two minutes/2 MiB, saved locally before upload. Failed uploads retry without deleting the recording, and create preconditions prevent duplicate objects after a lost acknowledgement. Test denied access, successful upload, lost-response retry, signed playback/download and non-admin rejection with a clearly identified synthetic feedback recording.

## Authenticated acceptance

1. Without credentials, both new routes must return the expected JSON 401, not HTML or 404. Run `npm run mobile:check-backend` from the source release.
2. With an active admin/manager token, GET `/api/territory-management?summary=1` must include `capabilities.pagedAssignments: true`. Verify create/transfer above 400 pins and past 1,000 scanned rows in staging; interruption/resume and delete must retain worked leads/history. Preserve the drawing if the backend fails.
3. Verify mobile-leads with each role: personal activity belongs to the authenticated rep; standard map pins lie in their assigned territories; admin/manager view only the requested viewport. Inactive/revoked accounts must be rejected. No client-supplied uid can grant another account's access.
4. Open the native app, select a lead, then test one approved knock and appointment request. Read back typed Timestamp fields, original time, rep uid/name, GPS and newest history. Confirm the scheduling webhook actually receives the existing payload. Check reporting after its cache refresh. Browser fixtures do not establish this live result.
5. Verify iPhone and Android recording upload/playback with real devices. A browser fake microphone is not sufficient.
6. Monitor reads, latency and Storage use during a small pilot before expanding distribution.

## Query and cost behavior

No change to homeowners query limits (500 per query), corrected lat/lng/geohash fields, or rules/indexes. Homeowner viewport work still uses the existing 2,000-read/12-query budget and persistent coverage cache. Standard-user requests intersect the viewport with assigned territory bounds; exact polygon filtering controls visible pins. This is display/query scoping, not a new Firestore security boundary.

Worked-map queries scan up to two pages of 500 existing latitude-index records per settled viewport, then filter longitude/territory. A dense latitude band may need a closer zoom to reveal all pins; the UI indicates partial results. Cached views last five minutes, with six retained in memory.

Personal activity refreshes reuse a 15-minute cache. Server pages are 500 records each; matching assigned/claimed/follow-up records are still read to identify recent activity. Admin recent activity uses the existing dispositionedAt index. Large accounts may still incur substantial reads even though summaries reduce phone memory. Projection reduces payload, not billed document reads. A retained result above 6,000 leads produces a visible error instead of false complete totals.

This design bounds viewport work and removes company-wide live subscriptions from phones, but it does **not** establish unchanged/lower Firebase bills. Actual read counts, server duration and feedback Storage/download use must be measured. No new map provider or paid AI subscription is introduced.

## Rollback

If authenticated acceptance fails, keep testers on the previous TestFlight build while fixing the companion. Keep old API actions intact so older mobile builds remain compatible. Do not uninstall an app or clear device data with unsynced knocks/recordings. Do not roll back by deleting lead data.
