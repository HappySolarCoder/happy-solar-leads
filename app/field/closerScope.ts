/** Solar consultants (role 'closer') may knock and disposition outside their territories (Evan, Nov 18 2026). */
export const KNOCK_ANYWHERE_ROLE = "closer";
export function knocksAnywhere(role: unknown): boolean { return role === KNOCK_ANYWHERE_ROLE; }
