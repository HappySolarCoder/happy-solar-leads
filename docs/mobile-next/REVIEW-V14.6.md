# Raydar v14.6 verification

## Result and boundary

The shared application export compiled and type-checked successfully. Both Capacitor projects synchronized and passed the current-version/production-configuration bundle checks. Native Xcode compilation, Android Gradle installation, real-device GPS, live-server operation, and TestFlight submission have not been performed in this environment. The delivered ZIPs build the native binaries on the user's Mac.

Story tested: a rep opens Knock, locates their position and territory, filters doors and sets Focus goals; a manager reviews a drawn area, assigns its available pins, renames/transfers it, and removes selected-user territory boundaries. Browser UI → actual API handler → in-memory Firestore adapter → response → UI was exercised for manager operations.

## Evidence

- 112 Node tests passed; zero failures. Includes the previous mobile suite and new territory/date/drawing coverage.
- Full `tsc --noEmit` passed. Corrected old iOS-simulator test-adapter signatures so the check covers tests too.
- Production mobile export passed using the production Firebase project and API origin; bundle verifier passed for `ios/App/App/public` and `android/app/src/main/assets/public`.
- Real exported-screen checks passed in Chromium at iPhone 393×852 and Android 360×800 sizes with simulated safe areas. These are browser simulations, not native device tests.
- Focus: doors 60 + appointments 3 saves exactly, persists through reload, and edits to doors 100 + appointments 5.
- Search: icon remains 44 pixels wide; opens address search. Areas: My/Team/Off and Zoom to mine work.
- GPS: admin and regular account initial centering, manual locate, pan preservation after further fixes, and centering after simulated foreground activation passed.
- Filters: no Solar Score filter; date and multiple dispositions combine. Date-unit checks handle Firestore timestamps and prefer the current disposition over old history.
- UI-to-handler territory checks: create a 450-pin area, rename it, transfer all 450 unworked pins, and verify notes stay intact; cancel bulk deletion, inject a failure, continue other removals, and retry the remaining boundary. Another user's area remains intact.
- Handler checks: scan 1,851 records, find 650 available pins, assign 649 after a concurrent knock changes one door, resume after an injected transaction failure, then transfer the 649 eligible pins. Large assignments do not grow a territory `leadIds` array.
- Authorization checks: a revoked/cross-team manager cannot continue an assignment; edits cannot interrupt a pending operation. Legacy document IDs with punctuation can be deleted; path traversal IDs are rejected.
- Drawing and responsive checks: touchscreen rectangle/freehand/corners, automatic closure, genuine-crossing validation, preserved draft details, sheet gestures, search, phone/landscape/desktop layouts passed. All automated database and browser scenarios use synthetic records; no production writes.

## Implementation notes

The admin-specific Rochester camera override and duplicate center/zoom effects were replaced with explicit camera requests. GPS positions update the location marker continuously; the camera recenters once for each foreground activation.

The latest-knock filter runs after existing role-based lead visibility. The My territory view filters by signed-in user ID. Team visibility uses the existing authenticated team-areas endpoint. Selecting a new assignee keeps that territory visible in the manager's filtered view.

The exact reported phone deletion error was not reproduced from a current device log. The updated flow handles partial failure, fresh-list retry, valid legacy IDs, and version checks, and exposes server errors. Real-device confirmation remains required.

## Server release requirement

The current main-branch territory implementation was inspected and still has the older server cap. New clients detect capabilities and retain existing tools with a clear notice until the v14.6 companion is available. Large assignment functionality is verified against the new handlers, not against the current production deployment. The companion is included separately; no website, database-rule, or TestFlight deployment was made.
