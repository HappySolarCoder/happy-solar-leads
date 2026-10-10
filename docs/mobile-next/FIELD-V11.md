# Raydar v11 — FMA field tools

This is a downloadable Capacitor mobile source build. It does not deploy the mobile app or change the production website when installed. Install over your existing Raydar app so device drafts remain available.

## Mac Terminal

```sh
curl -fL "https://github.com/HappySolarCoder/happy-solar-leads/archive/refs/heads/codex/raydar-mobile-redesign-v11.zip" -o "$HOME/Downloads/raydar-v11.zip" &&
ditto -x -k "$HOME/Downloads/raydar-v11.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v11" &&
bash scripts/mobile/install-android.sh
```

The installer reuses `.env.local` from a previous version in Downloads if this folder does not already have one, installs dependencies, checks the backend, builds the mobile bundle and opens Android Studio. Choose the Galaxy S25 and Run. Backend warnings do not prevent installing the app; the affected new tools stay unavailable until their companion backend is active.

## Available in this build

- Android on-demand voice dictation into an editable notes draft. Tap Save to store it. Android's installed speech recognizer determines availability and whether a network connection is needed; offline recognition is requested, not guaranteed. iPhone/browser users can use the keyboard microphone. Raydar does not record conversations or use a paid transcription API.
- Optional visit observations: answer/no answer, short/45-second-plus conversation, approved opener, objections, proof/preview shown and existing GPS checks. These are explicit observations, never inferred from time spent looking at a pin.
- Solar-fit shortlist with reasons and unknown-data states; no model or invented conversion probability.
- Street timing and return sweeps (recommendation #1): spaced not-home returns, different time windows, attempt caps and observed answer windows. A timing recommendation needs 20 attempts across at least three days. These are suggestions for now, not an optimized walking route or automatically scheduled future visits. Agreed go-backs keep their existing behavior.
- Personal/manager field insights with visible denominators, unknown contact/engagement data, opener comparisons and pilot/control groups. Show results use the latest resolved GHL result on doors marked set more than 24 hours ago, not a historical appointment-cohort conversion rate. Associations are not causal lift.
- Scheduling handoff tracking after the existing successful Send Info action. The existing Send Info → Call Scheduling Manager flow stays primary; no new calendar integration is substituted.
- Explicit prepared-area download (default 750 doors, maximum 1,000 and 15 MB), user-scoped IndexedDB cache and durable field notes/visit queue. Prepared leads expire after 24 hours; drafts remain until confirmed or explicitly discarded. Online sync rechecks assignment, account, proximity and conflicts. Blocked drafts can be copied/reviewed. Photos, lead editing, account management, sending info and other legacy actions still need connectivity. This is not universal offline support.
- Approved-only homeowner presentation, nearby proof and QR callback cards. These need the configuration described below; none contains fabricated proof or finance defaults. Callback cards request permission for one callback and preserve setter attribution. They do not send texts, book appointments or trigger automatic reminders.

## Backend companion — separate from the mobile ZIP

The new routes are `/api/field-config`, `/api/field-work`, `/api/field-recovery`, plus the public `/visit` page. The companion backend must be reviewed and merged into the main branch connected to the existing `happy-solar-leads` Vercel project before these tools activate. This release does not merge or deploy it automatically.

1. Review and merge the backend-only v11 companion. If v10 PR #152 is still open, deploy it first for user/territory management. Do not merge the whole mobile redesign branch into main.
2. Wait for that project's main deployment to show Ready.
3. In this mobile folder run `npm run mobile:check-backend`. Four authenticated routes should return their expected JSON 401 response when checked without login credentials. Signed-in use also validates the existing Firebase Admin credentials and account scope.
4. In Raydar, open Workspace → Field tools → Admin settings. Choose **Prepare a pilot for my account only**, then **Save pilot settings**. All new field flags default off until an admin enables them. A stable account hash assigns pilot/control; capture runs in both groups when enabled. Changing rollout configuration affects queued events when they sync; avoid changing an experiment while testers have pending work.
5. Start with a small real field pilot. Review contact/engagement data completeness and mature outcomes before expanding. Automated fixtures do not establish an appointment-rate improvement.

Existing server Firebase credentials are reused. No new Cloud project, paid AI service, scheduled job, history backfill or broad lead migration is required. New config is stored in `field_settings/v11`; observations, idempotency IDs, handoffs and callback permission are embedded in existing leads. No historical events are fabricated. Existing Firestore rules must continue preventing client escalation of account roles and server-owned configuration.

## Approved content setup

Admin settings contains an Approved content JSON editor. Start with:

```json
{"openers":[],"proof":[],"savings":null}
```

Opener records use `id`, `label`, `approvedTip`. Proof records use `id`, `title`, `city`, `state`, `quote`, optional HTTPS `imageUrl`/`sourceUrl` and optional numeric `lat`/`lng`, plus `permission:true`, `approved:true`, and an ISO `verifiedAt`. Supply only actual approved examples with permission to share; nearby proof is filtered geographically.

Savings require all of: `approved:true`, ISO `approvedAt`, nonempty `source`, state abbreviation, numeric `panelWatts`, `annualKwhPerKwLow`, `annualKwhPerKwHigh`, `avoidedRateLow`, `avoidedRateHigh`, `monthlyPaymentPerKwLow`, `monthlyPaymentPerKwHigh`, `fixedMonthlyCharge`, `selfConsumption` (0–1), and `exportRate`. Rates are dollars/kWh; payment factors are dollars/kW/month. Use reviewed assumptions appropriate to the configured state and financing terms. There is deliberately no copyable set of financial figures. Values expire after 180 days. The preview also requires the existing property's panel-capacity data and an entered bill; it caps credits to the variable bill and can display negative savings. It is an estimate, not a quote or roof design.

## Optional public callback activation

Leave recovery disabled until this is intentionally configured:

1. Deploy the public page and recovery API with the backend companion.
2. Set a new server-only `RAYDAR_RECOVERY_SECRET` of at least 32 random characters in the existing backend project. Never put it in `NEXT_PUBLIC_*` or the mobile `.env.local`. Generate locally with `openssl rand -hex 32`. Rotating it invalidates existing cards.
3. Add an edge rate-limit rule for `/api/field-recovery` (start with 30 requests per minute per IP; tune for your team). Tickets expire after 30 days. Callback POSTs are consent-gated, deduplicated for 24 hours and capped at three per door. There are no page-open tracking writes.
4. Set server-only `RAYDAR_RECOVERY_PUBLIC_ENABLED=true`, then redeploy that backend.
5. Set the actual public HTTPS origin and scheduling team's phone in admin settings, approve proof if desired, and enable recovery for a small pilot.

Self-booking, automated SMS, reminder delivery and provider/calendar integrations are deferred. The API does not contact homeowners. The public page omits names, exact addresses, private notes and private pin data; its opaque encrypted link carries limited attribution.

## Cost and performance

Scoring, timing and charts reuse loaded lead/history data on the device. They do not start new per-pin subscriptions. Lists render 25 rows initially; maps in presentations and QR generation load on demand. No continuous GPS or bulk map-tile download is added.

Safe field writes cost more reads than the legacy blind update: typically 3 transaction reads for a note/handoff or 4 for a knock, plus one lead write; a manager acting for someone else adds an owner-profile read and transaction retries may add reads. Config loading uses two reads per load. Recovery and existing reward logic have their own bounded reads/writes. Offline preparation uses already-loaded data. This is cost-controlled, not a promise of zero added Firebase cost. Keep the pilot small and review actual usage.

## Verification

60 automated mobile/server tests pass, TypeScript and focused lint pass, and the static mobile export builds. Phone-width browser checks exercise bounded lists, insights, approved-only demo presentation, persisted offline note drafts, prepared-area cache, callback consent and responsive widths using fictional data and no live database writes. Native Android compilation and speech recognition still require Android Studio/a device; no APK or device performance claim is made from browser tests.

Preview fixtures are clearly labeled and use synthetic people, roofs, savings and map tiles. They are not customer proof. The separate homeowner-data update is v12, not part of this release.
