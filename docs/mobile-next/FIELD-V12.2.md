# Raydar v12.2 — checked mobile release

This ZIP includes the v11 field tools, read-only homeowner pins, and the v12.2 code/UI audit fixes. It is a Capacitor source project for installation through Android Studio. Installing it does not deploy anything to Vercel or change the production web app.

## Download and install on the Mac mini

Paste only this block into Terminal:

```bash
curl -fL "https://github.com/HappySolarCoder/happy-solar-leads/archive/refs/heads/codex/raydar-mobile-redesign-v12.2.zip" -o "$HOME/Downloads/raydar-v12.2.zip" &&
ditto -x -k "$HOME/Downloads/raydar-v12.2.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v12.2" &&
bash scripts/mobile/install-android.sh
```

The installer copies `.env.local` from the latest earlier Raydar version it finds in Downloads, installs dependencies, checks backend availability, builds the real configured mobile app, and opens Android Studio. Select the connected Galaxy S25 and click Run. Install over the existing app; uninstalling can remove local drafts and downloaded records. The archive contains source, not an APK. Your existing variables are reused; there is no need to recreate the Firebase project.

If the folder is already unzipped, use:

```bash
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v12.2" &&
bash scripts/mobile/install-android.sh
```

## What changed

- Gray homeowner pins with owner/estimated renter details. Worked pins retain their outcomes and history. Matching and selection do not write, delete, or duplicate leads.
- Nearby records load after the map settles; complete cached areas are reused for 30 days. Rendering uses one canvas rather than thousands of extra HTML markers. The map/satellite toggle and roof-friendly worked pins remain.
- Homeowner pins now sit above imagery label tiles. The GPS location marker does not intercept house-pin taps.
- Native startup now goes straight to Today without mounting the legacy web map and starting its duplicate lead requests.
- Removed delayed map events and animations that could run after navigating away. Native connectivity changes now reach the field queue and homeowner loader. Android Back dismisses marked details/dialogs before navigating away; homeowner details trap focus and support Escape.
- Fixed narrow-screen admin/project layouts, date hydration mismatches, release-note dates, missing button labels, and older logo references. Legacy dashboard conversations no longer count Not Home as a conversation or show more conversations than knocks for the standard outcomes.
- Repaired the team map: compact slate header, collapsible list, useful empty/error states, current selected-member data, escaped text in map markers, bounded active-user query, stable zoom/pan, and shared mobile lead data. Activity explicitly refers to loaded pins. The old inactive menu button is removed.
- Appointments, team performance and the legacy dashboard now leave their loading state with a retry message when their outer load fails.
- Manage Workspace still opens the mobile Manage Users tool. Territory drawing, four-corner/rectangle modes, search, per-user areas, territory-only deletion, and history-preserving account removal remain.
- Field tools and editable voice-dictated notes from v11 are included. Send Info → Call Scheduling Manager stays the primary scheduling workflow. No paid AI service is added.

See [AUDIT-V12.2.md](AUDIT-V12.2.md) for the page inventory, checks and limitations, and [HOMEOWNERS-V12.md](HOMEOWNERS-V12.md) for exact caching/query/matching behavior.

## Backend availability is separate

The backend-only companion is [PR #153](https://github.com/HappySolarCoder/happy-solar-leads/pull/153). At release preparation it is open, draft and unmerged. It includes the pending v10 management backend from #152. No merge or production deployment was performed for this release.

If `mobile:check-backend` reports NOT READY, the app can still install, but the affected management/field tools need this separate backend deployment:

1. Review PR #153 against `main`; it includes #152, so a separate merge of #152 is not required. Do **not** merge the mobile redesign branch into the web app's production branch.
2. Merge the approved backend-only PR into the branch connected to the existing `happy-solar-leads` Vercel project. Wait for its deployment to be Ready.
3. In this downloaded mobile folder run `npm run mobile:check-backend`. All four routes must return the expected authentication response.
4. Open Workspace → Field tools → Admin settings, prepare the pilot for your account and save it. New field flags default off.

The optional public callback cards additionally need the explicit server activation, secret and rate-limit setup described in [FIELD-V11.md](FIELD-V11.md). Approved savings/proof need actual reviewed inputs. Voice dictation and device-side UI fixes do not require public callback activation.

## Homeowner access and costs

The homeowner layer reads your existing Firestore collection directly; it needs no new Vercel route. Live Firestore rules and imported records were not inspected or modified. If it reports **Homeowner access is not enabled**, add the reviewed match block from [firestore-homeowners-v12.rules.txt](firestore-homeowners-v12.rules.txt) inside the current Firebase rules' database-documents block and publish those rules. Keep the rest of the current rules. Do not replace them with this snippet.

Newly visited areas incur reads. Each settled map view has caps of 500 documents per query, 12 queries and 2,000 returned/minimum-query reads; the last limit is not a billing guarantee. Rules checks and retries can add reads. Complete, fresh cached coverage makes no homeowner query on repeat visits. Capped/dense areas ask for a closer zoom. Cache eviction and 30-day expiry can cause later reads. No per-home listeners, homeowner writes, full-collection load, or background catch-up scan is added. The existing team location listener is only active while its screen is open and is capped at 500 accounts.

In the fictional browser fixture, the first cache request fetched 399 records across two queries; repeat, reload and offline requests each made zero queries. These are test results, not a quote for your live Firebase bill. Field writes have the transaction costs documented in FIELD-V11.md.

## Verification limits

70 unit/server checks pass, TypeScript passes, and the static mobile export builds. The 48-route UI audit and interactive regressions use fictional data with remote requests mocked or blocked. Focused lint has no errors; an existing next/image advisory remains for the small inline SVG homeowner-list icons. This is not a claim that all legacy repository lint warnings were eliminated.

Native Android compilation, installed speech recognition, sensor/compass behavior, actual Galaxy S25 frame rate, live Firebase rules, GHL outcomes and deployed backend permissions still need device/live-account verification. On the first run, check a Buffalo/Rochester block, a worked pin and a gray pin, map panning, offline cached details, and the scheduler handoff. Nothing in the automated audit contacted homeowners or deleted real records.
