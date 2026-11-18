/** Solar consultants (role 'closer') may knock and disposition outside their territories (Evan, Nov 18 2026). */
export const KNOCK_ANYWHERE_ROLE = "closer";
export function knocksAnywhere(role: unknown): boolean { return role === KNOCK_ANYWHERE_ROLE; }

/** Shown on another rep's pin. Contact fields are not on the row. */
export const REDACTED_DOOR_NOTICE = "Another rep's door. You can log a knock here. Contact details stay with their rep.";
