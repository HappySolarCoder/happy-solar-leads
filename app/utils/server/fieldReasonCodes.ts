/**
 * Canonical field reason codes shared with /api/field/dispo, /api/field/sync-report,
 * and Raydar Mobile. Import this list. Do not copy it.
 *
 * notes_empty and notes_clear_mismatch are on this list so a deliberate clear
 * and a blank-notes rejection can be reported. payload_too_large is not: it is
 * only a /api/field/dispo response body code.
 */
export const FIELD_REASON_CODES = [
  'gps_unverified_held',
  'gps_unverified_flagged',
  'outside_50m',
  'permission_denied',
  'out_of_territory',
  'owned_by_other',
  'historical_pin',
  'not_found',
  'stale_tap',
  'notes_conflict',
  'notes_empty',
  'notes_clear_mismatch',
  'invalid_payload',
  'other',
] as const;

export type FieldReasonCode = (typeof FIELD_REASON_CODES)[number];
