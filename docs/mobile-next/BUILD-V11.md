# v11 plan: FMA field intelligence

Source: owner-provided Knock-to-Appointment_AI_Handoff.pdf (2026-10-10). Feature 2 already contains contact timing; include explicit street return sweeps. The owner's clarification governs: FMAs generate interest using the company script; the existing scheduling-manager send/call flow is the primary handoff. No paid AI service.

## Existing foundation

Next.js/React + Capacitor, Firebase Auth/Firestore, Leaflet imagery, per-lead disposition history, GPS/proximity gates, GHL outcomes, territory API, manual go-back scheduling, objection capture and scheduling-manager send/call. Mobile shares one live lead subscription. Current browser cache is not a durable offline work queue. Booking currently links to the existing GHL hub. No verified finance assumptions or approved customer proof dataset were supplied.

## Implementation order

1. Extend existing history with optional event ID, timezone, explicit contact/engagement, opener, objections, GPS, experiment exposure and territory fields. Preserve legacy records; do not fabricate missing timestamps, conversation duration or proof exposure. Reuse lead writes; no new per-knock analytics collection or full-database scans.
2. Authenticated, idempotent mobile partial-write endpoint; durable per-user device outbox and selected-area cache. Ownership, proximity and conflicts rechecked on sync. Pending records never masquerade as server-confirmed. Add on-demand Android system dictation and keyboard dictation on iOS/web; editable draft with manual save, no homeowner recording/transcription service.
3. Rule-based solar-fit ordering with reasons and unknown-data handling. Contact windows and spaced, capped revisit suggestions based on observed street/time outcomes, minimum sample sizes and configured work hours. Offline computed sweep lists; fit ordering is a shortlist, not an optimized walking route. No individual occupancy claims.
4. Field dashboard with observed denominators, meaningful unknown states, latest resolved outcomes on doors marked set and one evidence-backed suggestion. Opener comparisons show denominators; recommendations require enough data and are associations, not proof of causation. Stable rollout groups/flags are logged with events.
5. Verified-only property preview and approved nearby proof, with admin-owned assumptions/content. No paid Solar/OCR/rate lookup, fabricated roof geometry, or savings based on missing assumptions. Recovery links preserve setter/lead attribution; default to the current scheduling process, with a one-callback permission form; independent calendar booking is deferred until integration supports attribution. No automatic SMS or calendar mutation without configured provider and consent flow.
6. Tests, fictional offline/browser previews, backend-only companion PR, unique v11 snapshot and Terminal installation commands.

## Interpretation and release boundaries

The PDF's conversion-lift acceptance criteria require a real field pilot; test fixtures cannot establish uplift. Its competitor uniqueness claims are not established. Counting a conversation over 45 seconds requires an explicit observation, not time with a pin open. Historical status changes cannot reliably supply contact or engagement. Estimated renter labels stay estimates; only confirmed exclusions are treated as definite. Age/demographic profiles are not used for scripts or scoring.

Data-dependent features remain unavailable with a clear setup state until genuine inputs exist. Scheduled ML retraining, bill OCR, conversation recording/AI, paid property services, automatic outreach and independent closer scheduling are outside this no-paid-AI release. The rules baseline and integration contracts are implemented first. We will list exact remaining inputs and activation steps, not claim unsupported features are live.

## Cost controls

Scoring, timing, sorting and charts reuse loaded history. Pilot flags default off server-side. Offline preparation is explicit and bounded. Mutations use one lead transaction (read + write) with metadata embedded in its existing history; this adds transaction reads versus the old blind update, so do not promise a zero-cost increase. Configuration is shared across mobile tabs, and public recovery configuration is cached for one minute; no per-pin polling or background GPS. Public recovery and any notifications need rate limits and explicit activation before deployment.
