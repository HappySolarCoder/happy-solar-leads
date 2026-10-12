# Raydar v14.9 — backend work only

Repository: HappySolarCoder/happy-solar-leads
Source branch: codex/raydar-mobile-v14-9-fast-field-actions
Production: https://happy-solar-leads.vercel.app
Firebase: gen-lang-client-0395385938, (default) database.

Keep the existing v14.8 production changes. This update adds durable background territory assignment so the mobile app saves a boundary without scanning all pins first. Do not deploy the mobile static export as the website.

## Files

Apply these backend files from the branch to a branch based on current production; reconcile any newer production changes rather than replacing the production tree:

- app/utils/server/territoryManagement.ts (new save/retry actions and capability; existing actions retained)
- app/utils/server/territoryQueue.ts (new)
- app/api/territory-assignment-worker/route.ts (new)

Dependencies already present in production: app/utils/server/territoryManagementV2.ts, app/utils/territoryManager.ts, app/utils/firebase-admin.ts. No npm dependency additions. Keep the current v14.8 routes, authentication, web UI, field capture OFF, and Firestore rules/indexes unchanged. Do not modify homeowners or run any bulk scan/backfill. Assignment updates only eligible unworked leads through the existing 200-document transactional batches. Existing worked/claimed pins and history remain unchanged.

## Configure durable tasks

Use the existing Firebase service account (the client_email inside the server's FIREBASE_SERVICE_ACCOUNT, never a NEXT_PUBLIC value). It needs Cloud Tasks Enqueuer on this queue; do not grant Owner/Editor. Existing Firebase privileges remain as deployed. Use us-central1 unless your existing infrastructure requires another supported region, and set the queue path accordingly.

```bash
gcloud services enable cloudtasks.googleapis.com --project=gen-lang-client-0395385938
gcloud tasks queues create raydar-territories --project=gen-lang-client-0395385938 --location=us-central1 --max-concurrent-dispatches=1 --max-dispatches-per-second=1 --max-attempts=5 --max-retry-duration=0s --min-backoff=10s --max-backoff=120s --log-sampling-ratio=0
```

If the queue already exists, inspect it, then use `gcloud tasks queues update` with those limits. `max-retry-duration=0s` leaves the five-attempt bound in control. Grant the account `roles/cloudtasks.enqueuer` on that queue using the queue IAM policy. Set these **server-only Production Vercel** variables:

- TERRITORY_TASK_QUEUE=projects/gen-lang-client-0395385938/locations/us-central1/queues/raydar-territories
- TERRITORY_TASK_SECRET=a new random secret of at least 32 characters (e.g. `openssl rand -hex 32`)

Store the secret securely and do not print it in reports. It authenticates the worker through X-Raydar-Task-Secret. It must never be in a mobile bundle, NEXT_PUBLIC variable, client log, or GitHub. The worker target is fixed to the production HTTPS origin above. Restrict queue access because queued task headers contain this secret. No public/unauthenticated queue access.

Deploy these backend changes and server environment variables together to the existing production Vercel project. Worker maxDuration is 60 seconds; it processes at most 10 pages (2,000 scanned leads) per task and enqueues continuation using the persisted cursor. Check deployment protection/firewall permits Cloud Tasks requests with the application secret; do not expose unrelated protected deployments or disable site-wide security. Never use a fire-and-forget browser loop as a substitute.

## Cost constraints

The old preview read all candidate pages before the assignment read them again. The new workflow removes that preview pass. Map read limits, homeowner queries, and listeners are unchanged. The worker adds small territory/user bookkeeping reads and Cloud Tasks operations, so zero cost increase cannot be guaranteed. Google currently includes the first 1 million task operations per month free; that quota is shared and handler/Firestore usage is separate. Check existing usage before enabling. Do not upgrade a plan, add paid AI, run whole-database tests, or increase quotas. Rate/retry limits above are intentional. Report any expected paid usage to Evan.

Official references: https://cloud.google.com/tasks/pricing and https://cloud.google.com/sdk/gcloud/reference/tasks/queues/create

## Verify and report pass/fail

1. No-token GET /api/territory-management returns JSON 401. Wrong/missing worker secret on POST /api/territory-assignment-worker returns JSON 401 without database work.
2. Signed-in manager GET /api/territory-management?summary=1 reports pagedAssignments:true and backgroundAssignments:true. Non-manager and other-team access still denied.
3. Use an explicitly designated test territory. Save with action save-background-assignment, kind create, UUID requestId, name, userId, polygon. Response should acknowledge the saved boundary with background:true, queued:true without doing a lead scan. Measure elapsed time; target under 10 seconds. A queue failure must instead report queued:false with queueError and preserve the boundary for retry.
4. Close the app. Confirm the saved territory.assignment cursor/count progresses and done becomes true without client continue-assignment calls. Confirm only eligible test leads were assigned, with outcomes/history unchanged. Retry the same request to confirm no duplicate territory.
5. Pause the queue temporarily for the test, save, resume the queue and confirm completion. Test action retry-background-assignment with id if processing is stalled; it must resume, not reset counts. Restore the configured queue state.
6. Confirm archived/deleted territories stop processing, revoked manager permissions stop assignment, and there are no unbounded retries. Never use real historical pins as destructive test fixtures.
7. Check /login and the existing v14.8 endpoints still respond as before. Field capture remains off. Report deployment ID, changed files, measured save time, task attempts, read/write deltas, and anything not tested.

Rollback: pause this queue first, then promote the previous production deployment. Keep saved assignment cursors and boundaries; do not delete any lead data. Existing v14.8 continue-assignment remains available for recovery. Do not clear server credentials or change Firestore rules.
