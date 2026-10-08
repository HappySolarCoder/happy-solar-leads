# Raydar Next: a map-first field app

## Implemented in this revision

The knocking screen now has one 60px toolbar, with search, daily knock count, Map/List, filters, and GPS. The large title and persistent rows for metrics and secondary controls are removed. Filters, heat map, GHL outcome filter, pin guide and daily pace open in an on-demand sheet. **Map / Satellite** is an explicit two-button control on the real map: Map uses OpenStreetMap streets; Satellite uses Esri aerial imagery and labels (the default). Switching imagery preserves the pins and camera position. The design-gallery background is illustrative, not a replacement for the installed map.

The map keeps the remaining height; the Next door and Focus actions are small floating buttons.

Pins use reusable static SVG artwork: a pointed location tip, recognizable door/status symbol, solar-quality accent, and a separate GHL outcome badge. The selected pin has cyan corner brackets. At lower zoom, artwork simplifies to dots and existing clusters. Pin color still respects configured disposition colors. Historical pins retain their muted, restricted-data treatment. There is no per-pin animation, blur filter, external image request, or continuous effect.

**Next door:** a rule-based shortlist of up to five eligible assigned/claimed doors within one straight-line mile. Due go-backs come first, followed by previously interested leads, unworked good/great roofs, and not-home revisits from a previous day. It explains the reason for each suggestion and opens the existing lead actions. It excludes other reps' claims, historical pins, customers, booked/sold outcomes, negative statuses, unknown/custom statuses, and future-dated go-backs. It is not a prediction that a homeowner is home or an optimized walking route. The rep must check the agreed go-back time.

**Appointment focus:** optional targets of one, two or three appointments per session. Counts unique doors with an Appointment Set recorded by the current rep after the session began, including history when the lead later changes status. A GHL outcome alone does not earn an appointment. Personal session state stays on this device; company goals and lead records are unaffected. No countdown, speed ranking, push alert, or automatic message is added.

## Why large maps were slow

The mobile screen performed a full getLeadsAsync fetch alongside realtime listeners. Goal calculations and the mounted-but-closed goal modal could fetch the full lead set again. GPS changes cloned and distance-sorted every lead, feeding fresh objects back to the map. The map then cleared and recreated its visible markers, popup HTML and handlers during routine updates.

This revision:

- Uses the live listener as the single full-lead read path on the knocking screen, including goal calculations.
- Processes Firestore document changes while retaining unchanged lead objects.
- Preserves map lead references across GPS ticks; distance sorting runs only for the list/tools sheet.
- Uses a latitude index to select the visible map area plus a small buffer.
- Reconciles pins by ID: reuse unchanged instances, update changed icons, and remove pins leaving the viewport.
- Creates and inserts new pins in cancellable frame batches and creates popup HTML only when needed.
- Shares already-loaded dispositions with the map and defers loading lead details until used.

**Remaining database boundary:** the initial listener still downloads every lead in the account's authorized query (all leads for admins, assigned/claimed for reps). These app changes reduce duplicate reads and rendering work; they do not make the initial payload smaller. If a large account remains slow to receive data, the next step is server-side geographic queries or slim map-pin records with details fetched on tap. That requires planned Firestore indexes/rules and migration/backfill testing. No production database schema, rules, or indexes were changed here. Device/network timings and live Firebase load still require account testing.

## Research and next features

Primary-source review, October 8, 2026:

- [RepCard Canvassing](https://repcard.com/features/canvassing): territory visibility, door status, follow-up reminders and route planning.
- [RepCard Features](https://repcard.com/features): digital cards, setter/closer scheduling, competitions and leaderboards.
- [SalesRabbit field platform](https://salesrabbit.com/field-sales-platform/): canvassing, appointment scheduling, gamification and territory tools.
- [SalesRabbit lead management](https://salesrabbit.com/lead-management/): follow-ups, lead organization, area management and campaigns.

These are product descriptions, not independent proof of conversion lift. The implementation above adapts the useful patterns without copying interfaces or vendor performance claims.

The next best candidates for Happy Solar, in priority order:

| Idea | Why it may help appointments | What it needs |
| --- | --- | --- |
| Closer slot finder | Offer two genuinely available appointment times at the door; avoid booking friction and conflicts. | Real closer calendars, territory/travel constraints, atomic booking and cancellation handling. |
| Go-back window alerts | Surface an agreed follow-up when its time approaches and the rep is nearby. | Reliable stored time/time zone, notification permission, foreground/background design and duplicate-alert protection. |
| Quality scoreboard | Celebrate appointments that show and become sales, alongside sets, so the incentive is useful appointments. | Verified GHL links, correct setter attribution and consistent reporting windows. |
| Homeowner handoff | Show a branded identity card and prepare an appointment confirmation with the agreed next step. | Approved card/booking links, accurate appointment data, and rep review before any text is sent. |
| Neighborhood session plan | Suggest a short batch of eligible doors and scheduled go-backs, with exclusions and progress. | Walkable routes, territory boundaries, opt-out flags and dependable offline behavior. |
| Personal best by quality | Celebrate verified first show, a weekly show-rate improvement, or completed go-backs with a small earned badge. | Minimum sample sizes, comparable periods and actual event history; no fabricated streaks or pressure to overbook. |

Only Next door and Appointment focus are implemented from this list of appointment tools. Automated outreach, notifications, calendar booking and new company leaderboards are proposals.

## Verification

- Unit cases cover viewport selection from 10,000 pins, zero coordinates/date-line bounds, zoom/selection/outcome artwork, next-door exclusions and appointment attribution/deduplication.
- `CHROMIUM_EXECUTABLE=/path/to/chromium node scripts/mobile/check-map.mjs` runs the real Leaflet component with 10,000 synthetic pins. It creates a temporary route, blocks external requests, tests viewport rendering, GPS marker reuse, single-outcome updates, pin removal and panning, then removes the route.
- Result: 41 unit/regression tests passed. The real-map fixture displayed 551 viewport markers from 10,000 supplied pins; GPS preserved marker DOM instances, one outcome update reused existing markers, removals and panning worked, and zooming out produced clusters. The phone gallery passed 320/393/768px layout checks with a 60px toolbar and more than 75% of viewport height devoted to the map (including its sample banner).
- The test uses synthetic local data. It does not measure production Firebase latency, real satellite tile delivery, or physical-device performance.
