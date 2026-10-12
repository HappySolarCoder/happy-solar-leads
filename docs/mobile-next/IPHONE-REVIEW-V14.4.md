# v14.4 transport correction and verification

## Evidence and diagnosis

The user's October 11 v14.3 native log was inspected locally, without uploading its contents to GitHub. The Firestore hostname was associated with native connection identifiers, then completed transaction summaries were counted. HTTP summaries do not expose individual Firestore queries/documents, so they cannot attribute every byte to leads or prove which query is the sole cause.

| Evidence | Observation |
| --- | --- |
| Firestore transport | 1,482 completed HTTP transactions, all 200; 26,795,242 response body bytes |
| Individual transaction latency | Median 80 ms; many small responses arriving serially |
| App console | `profile-ready 418ms`; `leads-error 130171ms deadline-exceeded`; `directory-ready 128643ms` |
| Existing iOS configuration | Unconditionally forced long polling |
| Admin lead scope | Unbounded `leads` collection listener |
| Permissions | No `permission-denied` in the supplied app console; deployed rules were not independently inspected |

Firebase documents that forced long polling closes a response when data arrives and can degrade performance. This is consistent with the log, but HTTP 200 alone is not proof that every Firestore operation is authorized; query errors can be carried in a successful transport response. No evidence here justifies broadening rules or changing indexes.

The installed Firebase 12.9.0 SDK defaults to the XHR transport (`useFetchStreams` false). We are not introducing the fetch-stream mode implicated in the upstream WebKit issue. Automatic long-poll detection is enabled for iOS, allowing its fallback where buffering is detected. Android and browser settings are unchanged.

Sources inspected October 12, 2026 UTC:

- https://firebase.google.com/docs/reference/js/firestore.firestoresettings
- https://firebase.google.com/docs/firestore/real-time_queries_at_scale
- Installed `@firebase/firestore` SDK initialization and WebChannel code

## Changes

- Replaced iOS `experimentalForceLongPolling` with `experimentalAutoDetectLongPolling`.
- Startup diagnostic now reports `firestore-transport-auto`.
- Added `npm run mobile:ios:debug`: selects the installer's iPhone, starts native logging, relaunches the app with console output, and stops the native logger on exit.
- Updated native/visible release metadata to 14.4/144 and installer configuration lookup to include v14.3.
- No changes to lead query scope, permissions, rules, indexes, homeowner coordinates/cache, disposition fields, claim logic, scheduling payloads, or outbox storage. No additional database queries or retry loops were introduced. This is not a promise of zero Firebase cost: normal existing reads remain billable.

## Verification

Machine-readable results are in `VERIFICATION-V14.4.json`. The changed-file list is `CHANGED-FILES-V14.4.txt`.

Checks cover TypeScript/static production build, existing mobile unit tests, isolated browser data-loading regression tests, Capacitor iOS asset synchronization, and bundled production project/API/version verification. Browser fixtures are not native WebKit performance tests. Bash scripts are syntax-checked; their Xcode behavior must run on macOS.

**Native acceptance is pending:** this environment is Linux and cannot run Xcode/iPhone Simulator or a physical iPhone. The fix must be confirmed on Evan's simulator by a successful server lead snapshot and usable pins, with timing compared to the supplied failure. Android/iPhone test knocks, Scheduling Manager delivery, document readback and reporting attribution remain unverified on physical devices. No production data was changed during verification.

## Remaining limitation

The admin feed still downloads all leads at startup. Removing forced long polling addresses a concrete transport problem but does not reduce that data volume. A complete bounded viewport feed requires separating map data from follow-ups, Today totals, and team reporting, so limiting the shared feed does not silently hide records or undercount activity. This release does not impose a misleading arbitrary cap or add polling to work around the timeout.

Dependency versions are unchanged; the previous audit's 42 advisories remain unresolved. This release does not claim to be a dependency security update. The existing v14.2 authentication and v14.3 query-deduplication/recovery verification continues to apply.
