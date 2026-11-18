/**
 * Roles that may knock outside their own territories (Evan, Nov 18 2026).
 *
 * Solar consultants are the `closer` role (`UserRole` in app/types; no other
 * key or alias is in use: users/ had 0 docs with role 'sales' on Nov 18 2026).
 *
 * On POST /api/field/dispo a closer's KNOCK on a regular `leads` pin is never
 * refused (owned_by_other / out_of_territory) and never counts-only, in both
 * flag states (adminSettings/fieldOwnership legacy and territory): it is
 * applied like a staff knock, so its dispositionHistory entry counts for the
 * closer. Closers are also exempt from the out_of_area GPS flag there and
 * from the foreign-territory popup (popupExemptFor). Unchanged: notes-only
 * edits, claims, 3PL (`hotLeads`) territory gate, setters, staff.
 *
 * Shared by server and client code. Keep it dependency-free.
 */
export const KNOCK_ANYWHERE_ROLES = ['closer'] as const;

const ROLES: ReadonlySet<string> = new Set(KNOCK_ANYWHERE_ROLES);

export function knocksAnywhereRole(role: unknown): boolean {
  return typeof role === 'string' && ROLES.has(role);
}
