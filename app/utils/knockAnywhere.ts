/**
 * Roles that may knock outside their own territories (Evan, Nov 18 2026).
 *
 * Solar consultants are the `closer` role (`UserRole` in app/types; no other
 * key or alias is in use: users/ had 0 docs with role 'sales' on Nov 18 2026).
 *
 * On POST /api/field/dispo a closer's knock or notes edit on a regular `leads`
 * pin skips the ownership/territory gate like staff: never refused
 * (owned_by_other / out_of_territory) and never counts-only, in both flag
 * states (adminSettings/fieldOwnership legacy and territory). The dispo lands
 * on the pin and its dispositionHistory entry counts for the closer; on a pin
 * the closer does not own an extra fieldKnockEvents row (reason 'closer') is
 * written too. Closers skip the foreign-territory popup (popupExemptFor) and
 * see every rep's pins in the mobile map viewport (others' rows PII-redacted
 * outside their own territories). Unchanged: the out_of_area GPS flag, claims,
 * the 3PL (`hotLeads`) territory gate, setters, staff.
 *
 * Shared by server and client code. Keep it dependency-free.
 */
export const KNOCK_ANYWHERE_ROLES = ['closer'] as const;

/**
 * fieldKnockEvents `reason` on the extra event row written when a closer's knock lands on a
 * regular lead they do not own (so their own web/phone counters see it). Counts like any event.
 */
export const KNOCK_ANYWHERE_EVENT_REASON = 'closer' as const;

const ROLES: ReadonlySet<string> = new Set(KNOCK_ANYWHERE_ROLES);

export function knocksAnywhereRole(role: unknown): boolean {
  return typeof role === 'string' && ROLES.has(role);
}
