# Raydar v14.7 server companion — prepared, not deployed

This update is necessary for the native apps to create/transfer territories without the former 400-pin or 1,000-scan cutoff. It is separate from uploading an app to TestFlight.

The v14.7 app deliberately does not fall back to legacy preview. If the capability is missing, Review pins explains that the service needs updating and retains the drawing. This is why installing only a new iPhone/Android ZIP cannot complete the large-territory fix on production.

## Files

- `app/utils/server/territoryManagement.ts`
- `app/utils/server/territoryManagementV2.ts` (new)
- `app/utils/territoryManager.ts`

The existing `app/api/territory-management/route.ts` already calls `createTerritoryHandlers`; no new route or client credential is required. The existing API origin and Firebase project stay in use. No Firestore rules, security bypass, or new client Admin SDK is needed.

## Bot handoff prompt

Apply the v14.7 territory server companion to HappySolarCoder/happy-solar-leads in an isolated branch. Compare the three supplied files with current main and preserve unrelated changes. Keep the existing authenticated territory-management route. Do not deploy automatically; report the branch and checks for review first.

The GET response must include `capabilities.pagedAssignments: true`, lightweight territory summaries, and resumable `assignment` state. Support `preview-v2`, `begin-assignment`, and `continue-assignment` alongside the old actions so older native builds remain compatible.

The new native app pages through previews and assignment batches. Each request examines at most 200 lead documents. A territory has no application-level pin or geographic-size cap. Its `leadCount` records completed assignments; the new flow does not accumulate an unbounded `leadIds` array. New membership is tracked through each lead’s existing `territoryId` field. Transfers support both that field and old territory `leadIds`.

Each batch must recheck manager/admin authorization, team scope, active recipient, boundary membership, and current lead ownership/status inside the transaction. Keep reads before writes. Claimed/worked/customer/appointment records are excluded; their history and notes are never overwritten. Partial assignments stay visible as unfinished jobs and can resume. Do not allow rename/transfer to race an unfinished job. On successful transfer, update boundary ownership and the completed count. Delete actions remove boundaries only and preserve all lead records. Accept valid legacy Firestore document IDs containing spaces or punctuation, while rejecting slash/path traversal IDs.

Test with the included synthetic adapter and the v14.7 tests from the mobile source package. Confirm create/transfer above 400 pins, pagination past 1,000 scanned records, lost acknowledgement/retry, failure after a completed batch, fresh knock protection, revoked authorization, stale versions, single/bulk boundary deletion, and zero writes to unrelated leads.

Use a preview/staging deployment for a live-service smoke check before production. That deployment still needs explicit authorization in this workflow. Once the server is deployed, confirm an authenticated GET to `/api/territory-management?summary=1` reports `capabilities.pagedAssignments: true`, then test the v14.7 native packages. Do not mark the integration complete based only on mock tests.

## Operational semantics

A large assignment is resumable, not atomic across the whole territory: each batch commits separately. The screen reports completed progress and offers Resume assignment. The original manager confirms the target rep and polygon; each batch re-evaluates which doors are still available. Preview counts can differ from final counts when other reps work concurrently. Automatic retries never roll back legitimate work.

Deleting an unfinished boundary keeps any already assigned pins and their history. An archived boundary keeps audit metadata under `archived_territories`, as in previous versions. No migration of existing territories is required.
