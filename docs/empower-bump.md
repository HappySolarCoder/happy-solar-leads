# Empower bump: `POST /api/empower-bump`

Server side of the mobile Empower bump form. Upserts the GHL contact and the
Empower+ opportunity, then writes one event doc that ghl-sync turns into the
"Empower Plus bump" Discord post. This route never posts to Discord.

## Env (all unset in production until Evan says ship)

| Name | Effect when unset |
|---|---|
| `EMPOWER_BUMP_ENABLED` | `1`/`true`/`on`/`yes` enables. Unset or anything else: 503 `{"error":"Empower bump is not configured."}` before auth, with no GHL call, no Firestore write, no event. |
| `GHL_API_KEY` | GHL private integration token (contacts + opportunities write, location `MMKRDviKggXzlcHQTnvZ`). Not on this Vercel project today. Missing: 503, nothing written. |
| `EMPOWER_BUMP_GHL_ESTIMATED_BAND_FIELD_ID` | Contact field "Empower Estimated Band". No write until set. |
| `EMPOWER_BUMP_GHL_ASSISTANCE_FIELD_ID` | Contact field "Empower Government Assistance". No write until set. |
| `EMPOWER_BUMP_GHL_TAG` | Exact tag to add (e.g. `Empower Bump`). No tag write until set (adding a tag via API would create it in GHL). |

Existing `FIREBASE_SERVICE_ACCOUNT_JSON` / `GCP_PROJECT_ID` / `FIRESTORE_DATABASE_ID`
(the GHL warehouse DB that ghl-sync uses) carry the event doc.

## Storage

- `empowerBumpReceipts/{uid}_{draftId}` (Raydar DB): in-flight claim, then the
  receipt `{draftId, uid, leadId, actedAt, contactId, opportunityId, outcome, createdAt}`.
  Server-only; covered by the existing default-deny rule, so `firestore.rules` is unchanged.
  The claim is deleted on any failure, so a 4xx/5xx leaves no receipt.
- `empower_bump_events_v1/{draftId}` (GHL warehouse DB): create-only, `status: pending`.
  Fields: draftId, uid, leadId, opportunityId, contactId, outcome, opportunityCreated,
  name, town, repName, householdSize, estimatedTierLabel, assistanceYes, actedAt.
  No phone, email, address, or income.

## Band

Any assistance program -> Tier 1 (est.). An exact typed income is mapped with the
2026-03-18 county table: Tier 1 if income <= L, Tier 3 if L < income <= M, Comfort Home
if income > M (exactly at M stays Tier 3). Otherwise the client's band is used.
Official Empower Tier is written only as `Tier 1` / `Tier 3`.
