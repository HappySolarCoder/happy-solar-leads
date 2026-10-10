# Raydar Next v7 — video feedback fixes

## What changed

- **Today clock:** the greeting/date previously captured `new Date()` once. It now reads the device's local clock at minute boundaries, on window focus/visibility, and on native app resume. Before 12:00 is morning; 12:00–16:59 is afternoon; from 17:00 is evening. No UTC or New York override is used for the greeting. Goal reads are tied to the local day, not the clock refresh interval.
- **Follow-ups / View all:** a direct Next link targets `/mobile/follow-ups`, with a 44px minimum touch area. The existing callback route was correct; the native scrolling/fixed-navigation overlap could intercept taps. The navigation bar now occupies its own row, and page content scrolls above it.
- **Pin selection:** tapping no longer changes the icon or restarts the marker reconciliation batch. The existing marker gets a selection outline. Read-only lead details open immediately with cached data; settings load independently and actions wait for their configuration. Reps no longer download the entire user directory just to open a lead. The tap path does not write/delete a lead. A physical Galaxy reproduction is still needed to confirm every aspect of the originally reported disappearance; the old detail loader was reproduced in the browser fixture, while the old marker disappearance was not reproduced there.
- **Startup / tab switching:** one profile/settings load and one shared lead subscription set stays mounted across Today, Knock, Follow-ups, Progress and Workspace. The home shell waits for authenticated account resolution, not the full lead collection. Pending totals show dashes, not false zero/caught-up states. Data and page state clear on sign-out/account changes. Preview galleries do not connect to Firebase.
- **Blank map strip:** a ResizeObserver tells Leaflet when the map grows after the cached-data banner disappears. Map position/zoom are preserved. Satellite and street imagery remain available.
- **Territory errors:** HTML route-not-found is distinguished from a JSON record-not-found response. The real backend dependency remains; it cannot be installed by an Android app update.

## Territory backend: actual deployment status

Checked October 10, 2026:

- `GET https://happy-solar-leads.vercel.app/api/territory-management` returned **404 HTML**.
- Backend-only PR **#151** was still **open, draft, unmerged**.
- The app checks that HTTP response; there is no v6 version flag or missing table check.
- `mobile.env.example` points to that production origin. The user's Mac `.env.local` is not accessible here; the command below checks the actual configured origin without printing Firebase keys.

Installing v6/v7 does not deploy this server route. The prepared backend is three additive files, with no website screen, Firebase rule, dependency or index changes:

1. `app/api/territory-management/route.ts`
2. `app/utils/server/territoryManagement.ts`
3. `app/utils/territoryManager.ts`

### Exact activation steps

1. Open https://github.com/HappySolarCoder/happy-solar-leads/pull/151 . Mark the draft **Ready for review**, then **Squash and merge** into `main`. Deploy this backend-only PR; do not merge the complete mobile redesign PR #150 into the website.
2. In Vercel, open the project serving the origin in your app's `NEXT_PUBLIC_API_BASE_URL` (normally `happy-solar-leads.vercel.app`). Under **Settings → Environment Variables**, confirm the existing **FIREBASE_SERVICE_ACCOUNT** is available to **Production** and belongs to the existing Firebase project. Keep it on the server; do not copy it into the phone build.
3. Under **Deployments**, wait for the production deployment containing that merge to show **Ready**. If automatic production deployments are disabled, create a production deployment from `main` after the merge. Redeploying the old commit will not install the route.
4. In the unzipped v7 folder on the Mac, after copying your existing `.env.local` and running `npm ci`, run `npm run mobile:check-backend`. It prints the configured server URL and should report **READY** with the route's expected JSON **401** authentication response. No bearer token is sent by this check. A 404 means the selected deployment/origin still lacks the route; a redirect or HTML login response may indicate deployment protection.
5. On the phone, return to **Workspace → Manage territories → Try again**. An approved admin or a manager with a nonempty `users.team` can open the editor. Its signed-in request validates Firebase server credentials and account access. A 403 is a role/team/approval issue, not a missing deployment.
6. If the Mac's `.env.local` points at a different/old origin, correct **only NEXT_PUBLIC_API_BASE_URL**, rebuild with `npm run mobile:android`, and reinstall. Public environment variables are embedded at build time. If the origin already matches, deploying the backend does not require reinstalling v6 just to activate territories.
7. Before staff rollout, use a designated small test area to verify preview/create/rename/transfer/archive with an authorized manager. Assignment operations change shared production data and incur normal Firebase reads/writes.

No production merge/deployment or live assignment changes were performed while preparing v7.

## Install v7 on the Mac mini

Download and unzip:
https://github.com/HappySolarCoder/happy-solar-leads/archive/refs/heads/codex/raydar-mobile-redesign-v7.zip

```bash
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v7" &&
cp "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v6/.env.local" .env.local &&
npm ci &&
npm run mobile:android
```

If the prior working folder has a different name, use that folder for the `cp` source. Do not replace the working Firebase configuration. In Android Studio, wait for Gradle sync, choose the Galaxy S25, and click Run. The app ID remains `com.happyslr.raydar.next`.

## Verification

- 37 mobile unit/integration tests pass, including profile races, sign-out, territory API authorization/atomicity and existing compass/pin/outcome behavior.
- Full TypeScript check and focused lint of new/shared mobile components.
- Native Next static export: 43 routes.
- `check-startup-v7.mjs`: production mobile views/provider with a fake Firebase transport; 20-second pending-data test, unchanged subscription counts across tabs, account isolation/permission failure, sign-out cleanup, local greeting at noon/5pm/midnight/resume in **America/Phoenix and America/New_York**, direct View all navigation, scrolling at portrait/short/landscape sizes, and real Leaflet banner resizing.
- `check-pin-selection-v7.mjs`: real LeadMap and LeadDetail, touch selection, stable marker/image DOM, offline/online, zoom/pan/new snapshot, no writes and immutable lead contents. Other modals and network dependencies are fixtures.
- Existing v6 compass and territory UI browser regressions retained.
- No Android SDK is installed in this environment. Native APK/sensor behavior and actual startup seconds on the Galaxy must be checked on the Mac/phone. The tests prove the removed data-loading gate; they do not promise a specific hardware/network startup time.

The startup changes add no polling, collections or query expansion. They reduce repeated lead/profile/settings subscription work when switching tabs. Admin accounts still load their existing all-leads scope; first-load bandwidth and Firebase rules/data volume still affect pin arrival. Normal Firebase billing applies.
