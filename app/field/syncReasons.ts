/** Shared with POST /api/field/dispo and POST /api/field/sync-report. */
export const SYNC_REASON = {
  gpsUnverifiedHeld: "gps_unverified_held",
  gpsUnverifiedFlagged: "gps_unverified_flagged",
  outside50m: "outside_50m",
  permissionDenied: "permission_denied",
  outOfTerritory: "out_of_territory",
  ownedByOther: "owned_by_other",
  historicalPin: "historical_pin",
  notFound: "not_found",
  staleTap: "stale_tap",
  notesConflict: "notes_conflict",
  invalidPayload: "invalid_payload",
  other: "other",
} as const;

export type SyncReasonCode = (typeof SYNC_REASON)[keyof typeof SYNC_REASON];

/** Thrown when POST /api/field/dispo is not deployed. The draft stays queued. */
export const FIELD_DISPO_UNAVAILABLE = "field-dispo-unavailable";
