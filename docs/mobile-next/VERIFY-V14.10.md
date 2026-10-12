# Verification — Raydar 14.10 / 150

| Check | Result |
| --- | --- |
| TypeScript | PASS: `npx tsc --noEmit` |
| Automated mobile tests | PASS: 137 tests, zero failures |
| New helper/component lint | PASS: no errors or warnings |
| Four visits at one house | PASS: one latest-outcome pin; homeowner name; eight combined history entries; no selection writes |
| Neighboring address protection | PASS: different street numbers and distant towns/states remain separate |
| Homeowner layer off | PASS: duplicate visit pins remain grouped |
| Pin sizes | PASS: all worked zoom tiers doubled; unworked circles unchanged |
| Native DOM gesture in exported UI | PASS: 700ms hold, small jitter, cancellation, tap, pan and pinch checks at 393×852 and 360×800 |
| Manual pin save | PASS: immediate visible pin, correct status, original typed Timestamp fields, signed-in rep and GPS fields through durable queue |
| Existing knock/reporting flow | PASS: common dispositions, deferred GPS, offline/reconnect, lost acknowledgement, notes, claims/unclaims, follow-up cleanup and scheduling webhook payload using isolated fixtures |
| Business card | PASS: exact supplied URL, external-browser target, readable layout without horizontal overflow |
| Production static export | PASS: generated with production API/Firebase configuration |
| Actual iOS/Android native compilation, signing, TestFlight upload | NOT RUN: requires Mac/device tooling |
| Physical phone gestures and production homeowner data | NOT RUN: tester acceptance still required |

Browser checks used isolated Firebase fixtures and blocked real outbound traffic. Mobile-sized Chromium checks do not prove WKWebView behavior on a physical iPhone. No live homeowner/lead records, Firestore rules, indexes or backend routes were changed.

No bot deployment is required for this release. Preserve the existing backend and its configuration.

## Changed files

- `android/app/build.gradle`
- `app/components/AddLeadModal.tsx`
- `app/components/LeadDetail.tsx`
- `app/components/LeadMap.tsx`
- `app/field/FieldWorkspace.tsx`
- `app/homeowners/HouseHistory.tsx`
- `app/homeowners/houseIdentity.ts`
- `app/homeowners/model.ts`
- `app/mobile/_components/BusinessCardTool.tsx`
- `app/mobile/_lib/release.json`
- `app/mobile/knocking/page.tsx`
- `app/mobile/mobile.css`
- `app/mobile/more/page.tsx`
- `app/tools/page.tsx`
- `app/utils/fieldPin.ts`
- `app/utils/mapLongPress.ts`
- `docs/mobile-next/RELEASE-V14.10.md`
- `docs/mobile-next/VERIFY-V14.10.json`
- `docs/mobile-next/VERIFY-V14.10.md`
- `ios/App/App.xcodeproj/project.pbxproj`
- `scripts/mobile/check-pin-feedback-v1410.mjs`
- `scripts/mobile/install-android.sh`
- `scripts/mobile/install-ios.sh`
- `tests/mobile/compass-pins.test.ts`
- `tests/mobile/house-pins-v1410.test.ts`
