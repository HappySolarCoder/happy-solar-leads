/** Shared with POST /api/field/dispo and POST /api/field/sync-report. */
export const SYNC_REASON = {
  gpsUnverifiedHeld: "gps_unverified_held",
  gpsUnverifiedFlagged: "gps_unverified_flagged",
  outside50m: "outside_50m",
  permissionDenied: "permission_denied",
  outOfTerritory: "out_of_territory",
  ownedByOther: "owned_by_other",
  /** Queued slow retry when a knock body is over the route's 32 KB limit. */
  payloadTooLarge: "payload_too_large",
  historicalPin: "historical_pin",
  notFound: "not_found",
  staleTap: "stale_tap",
  notesConflict: "notes_conflict",
  /** Queued slow retry. A notes route 413, a notes body over 256 KB, or a notes/baseNotes 400. */
  notesTooLong: "notes_too_long",
  /** Parked. An old draft carried both a knock and a note, and it could not be split. */
  combinedDraft: "combined_draft",
  invalidPayload: "invalid_payload",
  other: "other",
} as const;

export type SyncReasonCode = (typeof SYNC_REASON)[keyof typeof SYNC_REASON];

/** Thrown when POST /api/field/dispo is not deployed. The draft stays queued. */
export const FIELD_DISPO_UNAVAILABLE = "field-dispo-unavailable";
