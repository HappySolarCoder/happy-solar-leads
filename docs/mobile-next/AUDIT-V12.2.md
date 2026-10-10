# Raydar v12.2 code and UI audit

## Scope and method

Inspected the code behind the map/data additions, native lifecycle, navigation and the issues found by the page audit. Loaded all **48 page routes** from an isolated static export at **393 × 852** and **360 × 800**, using a fictional signed-in account and America/Phoenix timezone. Reviewed screenshots of every route, including legacy pages and previews. The automated scan checks JavaScript errors, horizontal page overflow, unlabeled visible buttons and broken internal links. It is a rendering/navigation audit, not exhaustive verification of every possible form, account state or backend action.

All remote browser requests are mocked or blocked. Firebase/auth modules are replaced only in `check-export.mjs --audit`; the real installer and `build.mjs` never use those replacements. The management and field previews are labeled fictional. No production data was edited, deleted or messaged.

## Fixed findings

- Narrow-screen overflow on admin, disposition and project pages; cramped project rows.
- Timezone-dependent hydration on the Today preview and release-note dates.
- Native startup no longer mounts/fetches the legacy web map before redirecting to Today.
- Leaflet delayed move events after unmount; team-marker animation cleanup and stale selected-member callbacks.
- An incomplete mobile team-map route, obscured header/list, inactive menu button and obsolete styling. Shared mobile leads avoid a duplicate collection fetch; active locations are limited to 500 accounts while open.
- GPS marker interception of lead taps and homeowner-canvas placement below imagery labels.
- Android Back leaving detail views open while navigating; nested close controls and dialog handling corrected. Homeowner details now trap focus and support Escape.
- Native connectivity changes not consistently reaching the homeowner loader/field queue.
- Missing accessible button names, old logo references, and a legacy dashboard that counted Not Home as conversation and could exceed 100% for the standard fixture.
- Outer loading failures on appointments, team performance and dashboard now render a retry state.

## Verification

- TypeScript: pass. Static export of the mobile screens: pass.
- Unit/server checks: **70 passed**, including matching/cache budgets, stale-response cancellation, Android Back ordering, connectivity, territory/account safety and field-write authorization/idempotency.
- Focused lint: no errors. One advisory remains for inline SVG `<img>` icons in the homeowner list; no external image download is involved. Pre-existing lint debt in unrelated legacy code is not claimed resolved.
- Territory interactions: full-size map preserved through swipes/drawing; rectangle/four-corners/freehand; invalid boundary; redraw retains name/rep; review and assignment; town/ZIP; imagery; phone, landscape and desktop widths.
- Management interactions: 1,003-person territory picker renders 25 results per page, with scrolling/paging/search; per-user territories, cancel/single/bulk deletion; 181-account directory renders 30 rows per page; self-deletion blocked; delete/cancel feedback preserves pin-history wording.
- Homeowners: one canvas; direct gray-pin tap and accessible list; latest worked marker retained; owner/renter details; focus/Escape; labels do not cover pins; reload/offline cache; zoom guard. First fictional cache request: **399 records in 2 queries**, then **0 queries** for repeat/reload/offline. These are fixture results, not production costs.
- Field tools: bounded door lists, insights, approved-only demo presentation, prepared area, note draft surviving offline/reload, callback consent form, responsive widths. No real notification sent.
- Navigation: Today → View all → Follow-ups; Knock pin open/close without removing markers; team-map collapse, member selection and period filter; Workspace → Manage Users; setter restrictions.

## Route inventory

“Rendered” means the route or its intended redirect was displayed using the fixture. It does not mean a legacy roadmap placeholder was implemented or a live backend operation was verified. The installed app's Manage Workspace contains Manage Users only; legacy admin links route into the relevant mobile tools.

| Route | Review |
|---|---|
| `/` | Routes to Today for the signed-in fixture. |
| `/activity-map` | Rendered and reviewed at both phone widths. |
| `/admin` | Legacy browser page checked; installed app routes to Manage Workspace. |
| `/admin/assignments` | Legacy roadmap placeholder; installed app routes to the functioning territory editor. |
| `/admin/connections` | Rendered and reviewed at both phone widths. |
| `/admin/data-cleanup` | Legacy roadmap placeholder; installed app routes to Manage Workspace. |
| `/admin/dispositions` | Rendered and reviewed at both phone widths. |
| `/admin/easter-eggs` | Rendered and reviewed at both phone widths. |
| `/admin/roles` | Legacy roadmap placeholder; installed app routes to Manage Workspace. |
| `/admin/settings` | Rendered and reviewed at both phone widths. |
| `/admin/solar-madness` | Rendered and reviewed at both phone widths. |
| `/admin/solar-madness-bracket` | Rendered and reviewed at both phone widths. |
| `/admin/users` | Legacy browser page checked; installed app routes to Manage Users. |
| `/ai-manager` | Legacy browser page rendered. Installed app routes to Field tools; no paid AI key is shipped. |
| `/appointments` | Rendered and reviewed at both phone widths. |
| `/dashboard` | Standard conversation/appointment outcome counts corrected. |
| `/go-backs` | Rendered and reviewed at both phone widths. |
| `/lead-management` | Rendered and reviewed at both phone widths. |
| `/login` | Form layout only; no production authentication attempted. |
| `/mobile` | Rendered and reviewed at both phone widths. |
| `/mobile/field-tools` | Rendered and reviewed at both phone widths. |
| `/mobile/field-tools/preview` | Fictional field observations, insights, consent presentation, prepared area and durable offline draft. |
| `/mobile/field-tools/settings` | Rendered and reviewed at both phone widths. |
| `/mobile/follow-ups` | Rendered and reviewed at both phone widths. |
| `/mobile/homeowners/preview` | Fictional 1,200 homes, actual canvas tapping and IndexedDB cache, renter detail and latest-visit merge. |
| `/mobile/knocking` | Mocked loaded pins; selection/close preserves markers. No real knock saved. |
| `/mobile/more` | Rendered and reviewed at both phone widths. |
| `/mobile/preview` | Rendered and reviewed at both phone widths. |
| `/mobile/stats` | Rendered and reviewed at both phone widths. |
| `/mobile/team-map` | Real map component, fictional locations; collapse, selection, period filter and setter restriction tested. |
| `/mobile/territories` | Mocked authenticated backend response; editor interactions use preview fixtures. |
| `/mobile/territories/preview` | Fictional rectangle/corners/freehand, swipe, review, redraw, town/ZIP, single/bulk deletion tests. |
| `/mobile/workspace` | Rendered and reviewed at both phone widths. |
| `/mobile/workspace/users` | Mocked directory; destructive UI scenarios use preview fixtures. |
| `/mobile/workspace/users/preview` | Fictional 181-account paging, search, self-protection, cancel and delete tests. |
| `/objections` | Rendered and reviewed at both phone widths. |
| `/offline` | Rendered and reviewed at both phone widths. |
| `/pending-approval` | Approved-account redirect exercised; real pending-account approval was not submitted. |
| `/projects` | Existing local project board; responsive header and rows corrected. |
| `/release-notes` | Calendar-date formatting fixed to avoid timezone/hydration shift. |
| `/setter-stats` | Rendered and reviewed at both phone widths. |
| `/signup` | Form layout only; no real account created. |
| `/team-map` | Legacy entry uses the repaired team map. |
| `/territories` | Legacy redirect exercised; native route opens the mobile territory editor. |
| `/test-lazy-load` | Existing diagnostic page rendered; live data action not executed. |
| `/test-solar` | Existing diagnostic page rendered; paid Solar API action not executed. |
| `/tools` | Rendered and reviewed at both phone widths. |
| `/visit` | Missing-link layout and mocked callback-consent submission; no homeowner contacted. |

## Reproduce locally

```bash
npm run mobile:test
npx tsc --noEmit
node scripts/mobile/check-export.mjs
node scripts/mobile/check-export.mjs --audit
CHROMIUM_EXECUTABLE=/path/to/chromium node scripts/mobile/audit-pages.mjs
MOBILE_EXPORT_DIR=/tmp/raydar-v12-out CHROMIUM_EXECUTABLE=/path/to/chromium node scripts/mobile/check-homeowners-v12.mjs
MOBILE_EXPORT_DIR=/tmp/raydar-v12-out CHROMIUM_EXECUTABLE=/path/to/chromium node scripts/mobile/check-management-v10.mjs
MOBILE_EXPORT_DIR=/tmp/raydar-v12-out CHROMIUM_EXECUTABLE=/path/to/chromium node scripts/mobile/check-territories-v9.mjs
MOBILE_EXPORT_DIR=/tmp/raydar-v12-out CHROMIUM_EXECUTABLE=/path/to/chromium node scripts/mobile/check-field-v11.mjs
```

Use the real installer for installation, never the synthetic `/tmp` exports. Checks using port 4197 must run sequentially. The audit harness uses local Python HTTP servers and Playwright.

## Not established by this audit

No Android APK was compiled here: the Android SDK/Java toolchain and attached phone are unavailable. Native speech-recognizer availability, compass sensors, hardware Back events and actual Galaxy S25 performance require a device check. DOM/logic checks support those paths but do not replace it. Production authentication, Firebase rules/billing, GHL sync, backend deployment, calendar behavior and real destructive operations were not exercised. PR #153 remains a separate undeployed backend companion at release preparation. No claim is made that this update has already improved appointment conversion; that needs real field results.
