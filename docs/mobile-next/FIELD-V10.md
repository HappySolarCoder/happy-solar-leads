# Raydar field build v10

Download: https://github.com/HappySolarCoder/happy-solar-leads/archive/refs/heads/codex/raydar-mobile-redesign-v10.zip

## Install the backend first

1. Open https://github.com/HappySolarCoder/happy-solar-leads/pull/152 and merge the backend-only PR into main.
2. In the existing happy-solar-leads Vercel project, wait for the main deployment to show Ready. If automatic Git deployments are disabled, deploy the updated main branch there.
3. Run the commands below. `mobile:check-backend` must report READY for both management routes before building.

No new Firebase project, secrets, indexes or paid services are required. Existing server Firebase Admin credentials are reused. This PR changes management APIs and fixes existing test typings that otherwise fail the production type check; it does not replace website pages. Do not merge the entire mobile redesign PR into main just to activate the backend.

## Mac mini Terminal

Copy only the commands, without the terminal prompt or output. This uses the configuration from the working v9 folder.

```sh
curl -fL "https://github.com/HappySolarCoder/happy-solar-leads/archive/refs/heads/codex/raydar-mobile-redesign-v10.zip" -o "$HOME/Downloads/raydar-v10.zip" &&
ditto -x -k "$HOME/Downloads/raydar-v10.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v10" &&
cp "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v9/.env.local" .env.local &&
npm ci &&
npm run mobile:check-backend &&
npm run mobile:android
```

When Android Studio opens, select your connected Galaxy S25 and click Run. Install over the existing Raydar app; do not uninstall it first.

If the check returns 404 for `/api/mobile-user-management`, PR #152 is not deployed to the URL in `.env.local`. A ZIP/app installation does not deploy API routes. No login credentials are sent by this diagnostic; signed-in access still checks Firebase credentials and account permissions.

## What's changed

- Searchable, paged user pickers replace long Android native dropdowns. Only 25 people are rendered at once. Territory lists render 30 rows per page, map arrays are stable, and the v10 summary response omits large pin-ID arrays.
- Choose a user in Manage territories to show their areas on both the map and list. Select an area to delete it, or use Delete all territories for that user. Both require confirmation.
- Admin Manage Workspace now opens a mobile page containing only Manage Users. Search the directory and delete an account and all its territories. Your own account cannot be deleted here.

## What deletion does

Territory deletion removes the active boundary, retaining an archived boundary for audit. It never deletes, unassigns, or resets pins.

Account deletion disables Firebase Auth, revokes refresh tokens, archives/removes territory boundaries in bounded batches, then deletes the Auth account and users profile. A minimal identity record remains in `deleted_users` for audit. Existing lead assignments, statuses, notes, outcomes, embedded history and disposition-history documents are left untouched. This does not automatically reassign the former user's pins. Account deletion is permanent, while interrupted operations can be retried to finish.

Managers can delete territories only within their existing team scope. Only active, approved admins can delete accounts. All authorization and stale-data checks run server-side.

## Costs and limits

Searching, paging and scrolling the loaded directory cause no additional Firebase reads. Opening or refreshing it reads the user directory. Deletion incurs normal reads/writes for the selected user and territory/archive records, not a scan of every pin. Territory management retains its existing 500-active-area limit; the account directory is capped at 2,000 profiles. No paid map service or always-on listener was added.

## Verification and limits

- 45 mobile/unit tests passed, including real route handlers with an in-memory database adapter. Lead/history records remain byte-for-byte unchanged after both deletion paths. Tests cover permission failures, self-deletion, stale versions, revoked sessions, rollback, idempotent replay, 205-territory deletion and Auth failure/retry.
- Mobile TypeScript, focused ESLint and the static native web bundle passed.
- Phone-sized Chromium checks passed with 1,003 fictional territory-picker users and 181 fictional account rows: scrolling, paging, search, per-user filtering, deletion/cancel and responsive widths. Existing rectangle/freehand/corners, sheet swipe, redraw, imagery and search checks still pass.
- Backend-only checkout: TypeScript and 36 tests passed, including the pre-existing tests whose typings were corrected for deployment.
- No real users or territories were deleted during testing. The Galaxy S25 crash was not reproduced; the changes reduce likely picker/rendering pressure. If it closes again, capture Android Studio Logcat immediately after the crash. No native APK/device test was possible in this environment.
