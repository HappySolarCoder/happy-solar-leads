import type { User, UserRole } from '@/app/types';

/** ~50 meters (~164 feet). Matches the existing GPS knock / drop-pin gate. */
export const PROXIMITY_MAX_DISTANCE_METERS = 50;

/**
 * Roles that must be near the address to knock / drop a pin.
 * Kept in sync with the previous inline checks in LeadDetail + LeadMap.
 * (`sales` is not a typed UserRole today but is still honored if present.)
 */
const PROXIMITY_ROLES = new Set<string>(['setter', 'manager', 'sales']);

export type ProximityUser = Pick<User, 'role' | 'features'> | {
  role?: UserRole | string;
  features?: User['features'];
} | null | undefined;

/**
 * Per-user flag. Missing / true = enforce (default ON).
 * Only an explicit `false` opts the user out.
 */
export function isProximityEnforcementEnabled(user: ProximityUser): boolean {
  return user?.features?.proximityEnforcement !== false;
}

/**
 * Whether the ~50m GPS gate should run for this user.
 * Role list is unchanged; the per-user flag can only skip the gate.
 */
export function isProximityRequired(user: ProximityUser): boolean {
  if (!user?.role || !PROXIMITY_ROLES.has(user.role)) {
    return false;
  }
  return isProximityEnforcementEnabled(user);
}
