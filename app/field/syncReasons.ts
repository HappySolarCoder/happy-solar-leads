/**
 * Shared with POST /api/field/dispo and POST /api/field/sync-report.
 * notes_empty and notes_clear_mismatch match main 15efe05 (PR #175).
 * Requires #175 deployed. notes_rejected is local, like contact_denied.
 */
export const SYNC_REASON = {
  gpsUnverifiedHeld: "gps_unverified_held",
  gpsUnverifiedFlagged: "gps_unverified_flagged",
  outside50m: "outside_50m",
  permissionDenied: "permission_denied",
  outOfTerritory: "out_of_territory",
  ownedByOther: "owned_by_other",
  /** A 413 from the route. Parked as notes_too_long. Not a slow retry. */
  payloadTooLarge: "payload_too_large",
  historicalPin: "historical_pin",
  notFound: "not_found",
  staleTap: "stale_tap",
  notesConflict: "notes_conflict",
  /** On the shared list at 15efe05. The client parks the draft as notes_rejected. */
  notesEmpty: "notes_empty",
  /** On the shared list at 15efe05. The client parks the draft as notes_rejected. */
  notesClearMismatch: "notes_clear_mismatch",
  /**
   * Parked. A notes_empty or notes_clear_mismatch 400, or a 400 whose field
   * is clearNotes. The note text stays. There is no retry and the flag is
   * not stripped. Diagnostics shows this code. The sync-report wire maps it
   * to invalid_payload, which the live route accepts.
   */
  notesRejected: "notes_rejected",
  /** Parked. Every notes 413, including one with no reasonCode, a notes body over 256 KB, or a notes/baseNotes 400 that is not a clear rejection. Not retried. */
  notesTooLong: "notes_too_long",
  /** Parked. An old draft carried both a knock and a note, and it could not be split. */
  combinedDraft: "combined_draft",
  /**
   * Parked. A direct contact or photo write was permission-denied.
   * It is not retried as a notes body. Diagnostics shows this code.
   * The sync-report wire maps it to permission_denied, which the live route accepts.
   */
  contactDenied: "contact_denied",
  invalidPayload: "invalid_payload",
  other: "other",
} as const;

export type SyncReasonCode = (typeof SYNC_REASON)[keyof typeof SYNC_REASON];

/** Thrown when POST /api/field/dispo is not deployed. The draft stays queued. */
export const FIELD_DISPO_UNAVAILABLE = "field-dispo-unavailable";
