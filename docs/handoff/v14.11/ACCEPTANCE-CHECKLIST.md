# Raydar v14.11 acceptance record

All rows start **NOT TESTED**. This is a receiving-team checklist, not a claim that device/live tests already passed. Historical automated evidence is in `docs/mobile-next/VERIFY-V14.11.md` and `.json`.

- Tester / date:
- Source commit / branch:
- App version / build:
- iPhone model / iOS / Xcode:
- Android model / OS / Java / Android Studio:
- API deployment / Firebase project:
- Approved synthetic account / record identifiers (no credentials):
- Signing owner / next unused store build number:

| Check | Expected result | Result / evidence |
| --- | --- | --- |
| Source and archive identity | Manifest and SHA-256 match; no newer work overwritten | NOT TESTED |
| Serial mobile tests | All tests pass without relaxing thresholds | NOT TESTED |
| Configured build and sync | out and target native manifest show intended version/build | NOT TESTED |
| Native compile and signing | Both platforms compile under existing app/signing identities | NOT TESTED |
| Login, force-close, reopen | Correct user/session restores without persistent spinner | NOT TESTED |
| Account switch / revoked role | Protected data and drafts do not cross accounts; revoked access rejected | NOT TESTED |
| Newest loaded visit | One pin per house, latest configured knock shown; timestamp ties correct | NOT TESTED |
| Nearby houses / aliases | Different street numbers remain separate; genuine same-house aliases group | NOT TESTED |
| Homeowner layer on/off | No duplicate pins or corrected-roof position jumps | NOT TESTED |
| Partial / empty / failed viewport page | Known in-scope pins remain visible; no transient flashing | NOT TESTED |
| Load more / filter / zoom | Cursor resumes; filters behave; bounded read policy remains | NOT TESTED |
| Manual pin with keyboard | Last field scrolls and Save stays reachable on short phone/large text | NOT TESTED |
| Saved manual lead | Exactly one document; original actor/time/GPS; visible after refresh | NOT TESTED |
| Offline action, app close, reconnect | Draft survives and commits once under original account | NOT TESTED |
| Lost acknowledgement / replay | No duplicate history or backward status/GPS change | NOT TESTED |
| Denied / stale / distant GPS | Existing proximity policy holds; blocked work remains reviewable | NOT TESTED |
| Discard + late GPS completion | Discarded draft does not reappear; wrong account cannot replay it | NOT TESTED |
| Reporting | Original Firestore Timestamp, UID/name, status and history remain correct | NOT TESTED |
| Scheduling request | Lead synced first; exactly one approved payload reaches receiver | NOT TESTED |
| GHL update | Outcome badge refreshes without changing knock status/history/ownership | NOT TESTED |
| Territory capability | Authorized summary confirms actual paging/background capabilities | NOT TESTED |
| Background territory assignment | Approved boundary progresses while app closed; retry preserves cursor/worked leads | NOT TESTED |
| Feedback / dictation | Real microphone permissions, cancel, upload retry and private playback work | NOT TESTED |
| Native lifecycle | Repeated resume, Android Back, keyboard and orientation remain usable | NOT TESTED |
| Cost and read observation | Actual Firestore/API/queue/Storage usage reviewed on bounded pilot | NOT TESTED |
| Rollout gate | Signing owner, build number, backend compatibility and test group confirmed | NOT TESTED |

For each failure record minimal sanitized reproduction steps, expected/actual behavior, timestamps, relevant version/record IDs, and screenshots/log excerpts. Preserve pending device work. Do not store tokens, service-account JSON, homeowner contact information or recordings in this checklist.

## Decision

- Ready for designated pilot: NOT DETERMINED
- Ready for wider distribution: NOT DETERMINED
- Blocking issues:
- Owner decision / date:
