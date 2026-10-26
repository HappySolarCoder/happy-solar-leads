/**
 * Canonical field reason codes shared with /api/field/dispo and Raydar Mobile.
 * Import this list. Do not copy it.
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
  'invalid_payload',
  'other',
] as const;

export type FieldReasonCode = (typeof FIELD_REASON_CODES)[number];
