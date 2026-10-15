# Verification — Raydar 14.11 / 151

| Check | Result |
| --- | --- |
| Final source TypeScript | PASS during the production Next.js static export |
| Mobile regressions | PASS: 146 tests, zero failures, run with `node --import tsx --test --test-concurrency=1 tests/mobile/*.test.ts` |
| Spatial matching | PASS: 10,000 leads and 1,500 homeowners in 487 ms in the final serial suite |
| Stale and duplicate records | PASS: newest event wins regardless of source arrival order; postal aliases resolve independently of page order; neighboring addresses remain separate |
| Latest history and artwork | PASS: newer history corrects stale displayed status; existing customer type does not override a later knock symbol |
| History and selection | PASS: four records produce one latest-result pin and eight displayed history entries; selecting and grouping write nothing |
| Delayed viewport refresh | PASS: loaded pins remain through an empty first page, a delayed next page, and a 503 response; DOM observer recorded no missing/duplicate pin frames |
| New representative document | PASS: the later visit reuses the existing Leaflet marker |
| Dense views | PASS: Load more pins is tappable and resumes the returned cursor |
| Manual lead dialog | PASS: fields scroll and Save Lead stays reachable at 393×852 and 360×640, with simulated visual viewport heights of 320 and 260 pixels and a 35-pixel viewport offset |
| Manual lead save | PASS: one write, one visible new pin, typed address retained, existing Timestamp/GPS/actor contract preserved |
| Existing touch and tools behavior | PASS: long press, jitter, pan/pinch/cancel checks, homeowner layer off, and existing business-card link |
| React/lint review | No new diagnostics in changed reviewed files versus v14.10. Existing lint debt remains: 27 errors in the reviewed legacy map/page files; this is not a clean full-repository lint result |
| Configured export and native assets | PASS: production API/Firebase configuration, v14.11/151 manifest, both platform assets generated, both Capacitor projects synced and bundled versions verified |
| Physical iPhone/Android, signing and store upload | NOT RUN: platform/device tooling required |

The default parallel test run hit the existing one-second spatial timing threshold while other work was running. The isolated spatial test and the final complete serial suite passed without changing that threshold.

Browser checks used Chromium 153 with fictional Firebase/API adapters and blocked non-local traffic. Keyboard geometry was simulated; these checks do not prove physical WKWebView behavior. The final production export uses the real public app configuration and contains no synthetic auth/write adapters. No live lead/homeowner records, rules, indexes, backend routes, signing configuration, or production deployment were changed.

Latest-pin correctness is relative to records loaded for the authorized area. Dense areas can require Load more pins or a closer zoom; the app does not silently perform an unbounded scan.

Evidence and repeatable checks:

- `VERIFY-V14.11.json`
- `v1411-manual-keyboard.png`
- `v1411-pins-after-network-error.png`
- `scripts/mobile/check-pin-stability-v1411.mjs`
- `scripts/mobile/check-viewport-stability-v1411.mjs`
- `tests/mobile/pin-stability-v1411.test.ts`
