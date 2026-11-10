import {
  FOREIGN_TERRITORY_WARNING,
  foreignTerritoryWarning,
  popupExemptFor,
  type PreparedTerritory,
} from './effectiveOwner';

/**
 * Pure decision: should the rep see "Warning: You are in another user's
 * territory. Do you wish to place this pin?" before placing or dispositioning
 * a pin. Every time, no memory. Never when the flag is not 'territory', the
 * point has no territory, the rep is one of its assignees (dual owner), or the
 * role is exempt (staff default exempt, TBD with Evan: effectiveOwner.STAFF_POPUP_EXEMPT).
 */
export function shouldWarnForeignTerritory(input: {
  mode: 'legacy' | 'territory';
  territories: readonly PreparedTerritory[];
  uid: string | undefined;
  role: unknown;
  lat: unknown;
  lng: unknown;
}): boolean {
  if (input.mode !== 'territory' || !input.uid) return false;
  if (popupExemptFor(input.role)) return false;
  return foreignTerritoryWarning(input.lat, input.lng, input.uid, input.territories).warn;
}

/**
 * Browser gate. Resolves true to proceed. A confirmed knock proceeds and counts
 * (the server accepts it or stores it as a counts-only event); cancel writes nothing.
 * Any failure to load ownership resolves true: the warning never blocks work.
 */
export async function confirmForeignTerritory(
  point: { lat?: unknown; lng?: unknown },
  user: { id?: string; role?: unknown } | null | undefined,
  confirmFn: (message: string) => boolean = (message) => window.confirm(message),
): Promise<boolean> {
  try {
    const { loadFieldOwnership } = await import('./useFieldOwnership');
    const view = await loadFieldOwnership();
    const warn = shouldWarnForeignTerritory({
      mode: view.mode,
      territories: view.territories,
      uid: user?.id,
      role: user?.role,
      lat: point.lat,
      lng: point.lng,
    });
    return warn ? confirmFn(FOREIGN_TERRITORY_WARNING) : true;
  } catch {
    return true;
  }
}
