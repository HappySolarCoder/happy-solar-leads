# Raydar Next

An isolated mobile redesign based on `codex/native-mobile-app`. The original app and main branch are not replaced. Android and iOS use app ID `com.happyslr.raydar.next` and display name **Raydar Next**, so both apps can be installed side by side. Both still use the same configured Firebase database: real lead edits affect shared company records.

## Install on the Mac already set up for Raydar

1. Download the ZIP for `codex/raydar-mobile-redesign` from GitHub and unzip it in Downloads.
2. In Terminal run:

```bash
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign" && cp "$HOME/Downloads/happy-solar-leads-codex-native-mobile-app/.env.local" .env.local && npm ci && npm run mobile:android
```

3. Let Android Studio sync. Choose **JVM 21** if prompted. Select the Galaxy S25 and click Run.
4. Look for **Raydar Next** on the phone. The existing Raydar installation stays available.

For iOS, run `npm run mobile:ios`, select the signing team for the new bundle ID, and use a simulator or registered iPhone. This branch has not been compiled or tested on a physical device in this environment.

## Design and workflows

- Today: personal activity, goal-based daily pace, scheduled go-backs, recent appointment outcomes, and one primary Start knocking action.
- Knock: labeled Map/List switch, location accuracy, address search, count of active filters, reset filters, nearest great roof, daily pace, heat map, and a GHL outcome filter/legend.
- Follow-ups: searchable agenda grouped into overdue, today, upcoming, and undated records when present; existing scheduling and editing open from lead details.
- Progress: Today/This week/This month selector, working seven-day chart, and clearly defined activity metrics. Removed the old misleading all-time personal bests and unscoped team-average comparison.
- Account: existing field tools, appointments, team reporting, role-gated management links, GHL sync status/control for managers/admins, and sign-out.
- Warmer off-white surfaces, green/coral accents, larger labeled controls, reduced-motion support, visible keyboard focus, mobile safe-area compatibility.

The stat definitions retain the existing latest-disposition-per-lead model. They are not a new event-history reporting system. Knock attribution now prefers the latest disposition actor, then legacy claimed/assigned ownership, and respects configured countsAsDoorKnock values. Interested+ includes interested/appointment/sale; Appointments+ includes appointment/sale. Week begins Monday.

## Appointment outcomes: connection and behavior

The repository already includes a server-side GHL-to-Raydar sync at `/api/admin/sync-appointments`. It reads the configured GHL Firestore database through `app/utils/ghl-firestore.ts`, matches opportunities using the existing implementation, and mirrors these fields onto Raydar `leads/{id}` records:

- `appointmentOutcome`
- `ghlStatus`, `ghlOpportunityId`, `ghlContactId`, `pipelineStageId`
- `appointmentDateTime`, `ghlLastUpdatedAt`

Raydar Next uses Firestore realtime listeners for those lead records. An assigned rep receives updates through an `assignedTo == uid` query; the existing `claimedBy == uid` scope is also retained. Only admins subscribe to all leads. The listeners are cleaned up when the screen/account changes; permission errors discard displayed records and cached data is labeled as potentially out of date.

Outcome labels/colors: Sold (green/check), Show (blue/S), No show (red/!), Rescheduled (amber/return arrow), Cancelled (purple/x), Lost (gray/minus), Scheduled (indigo/A). Unknown/custom outcomes keep their source label with a neutral marker. Source text is escaped in map HTML. Other reps' historical territory pins never gain private outcome details.

Changing the outcome changes the rendered pin, list badge, home update, and open lead detail. It does **not** write or replace `status`, `disposition`, `dispositionHistory`, `claimedBy`, or `assignedTo`. A Sold outcome does not silently convert a knock disposition into a sale.

Managers/admins can use **Account → Sync GHL outcomes** to call the existing authorized sync and view its result. This writes shared CRM feedback fields through the existing backend. Reps cannot trigger the admin sync. There is no new GHL credential in the mobile bundle.

### Live verification still required

The app-side update path is implemented and locally tested. Production GHL access and the upstream sync schedule were not accessible during this work. **This change does not create an automatic GHL polling job.** The existing sync must run (manually or through your existing automation) before a change in the separate GHL mirror reaches a Raydar pin.

The existing backend needs its existing server-only `FIREBASE_SERVICE_ACCOUNT_JSON`, GHL `GCP_PROJECT_ID`/`FIRESTORE_DATABASE_ID` when applicable, and any configured collection overrides. Never put those values in `.env.local` as NEXT_PUBLIC variables or send them in chat. Keep the original backend origin in the mobile public config.

Acceptance: choose a test lead already assigned to the tester and linked to GHL; change its outcome through your usual GHL test workflow; run the existing sync as an admin if it is not scheduled; confirm the Firebase appointmentOutcome updates and the correct rep's marker and open detail change without refresh. Check a second unauthorized rep cannot read that lead. Confirm assignment and door-knock disposition stay unchanged. No production outcome or lead was modified for our local tests.

## Preview and validation

`/mobile/preview/` is an interactive read-only gallery with clearly labeled fictional data. It uses the same Today, Follow-ups, Progress, navigation, field-toolbar and outcome components as the installed app. The gallery map is illustrative; the real Knock screen retains the existing Leaflet map, lead actions, solar filters, and server data. The gallery does not write to Firebase.

Screenshots are in `docs/mobile-next/`. The browser check covered navigation, outcome filtering/details, search/empty/reset states, period switching and horizontal overflow at 320, 393, 768 and 1280px.

Run:

```bash
npm run mobile:test
npx tsc --noEmit
npm run mobile:build
npx cap sync
```

The mobile export, standard web build, focused lint, TypeScript and 36 relevant regression tests passed. Native builds, GPS on a device, production sign-in, Firestore security-rule behavior, and a real GHL-to-pin update still require device/account acceptance. Background GPS, push notifications, and durable offline saves are not added by this redesign.
