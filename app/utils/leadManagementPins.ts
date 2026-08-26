import type { Lead } from '../types';

export const DEFAULT_LEAD_MANAGEMENT_CENTER: [number, number] = [43.1566, -77.6088];
export const DEFAULT_LEAD_MANAGEMENT_ZOOM = 11;
export const LEAD_MANAGEMENT_LOAD_TIMEOUT_MS = 15_000;

export type LeadManagementBounds = {
  south: number;
  north: number;
  west: number;
  east: number;
  maxLeads: number;
};

export type LeadManagementPinLoaders = {
  getLeadsInBounds: (
    south: number,
    north: number,
    west: number,
    east: number,
    maxLeads: number,
  ) => Promise<Lead[]>;
  getLeadsInBoundsForUser: (
    uid: string,
    south: number,
    north: number,
    west: number,
    east: number,
    maxLeads: number,
  ) => Promise<Lead[]>;
  getLeadsForUserLimited: (uid: string, maxLeads: number) => Promise<Lead[]>;
};

export function leadManagementBoundsFromView(
  center: [number, number],
  zoom: number,
): LeadManagementBounds {
  const latPad = 0.15 * Math.pow(2, Math.max(0, 11 - zoom));
  const lngPad = 0.25 * Math.pow(2, Math.max(0, 11 - zoom));
  return {
    south: center[0] - latPad,
    north: center[0] + latPad,
    west: center[1] - lngPad,
    east: center[1] + lngPad,
    maxLeads: zoom >= 15 ? 4000 : zoom >= 13 ? 3000 : 2000,
  };
}

/**
 * Pins for /lead-management. Never call getLeadsAsync / getAllLeads here —
 * those dump the whole collection (admin) or the whole assigned set (manager)
 * and the page used to await that before leaving Loading.
 *
 * Admin: lat-range query (automatic lat index; rules allow admin all-leads reads).
 * Manager: do not run an unfiltered lat query (rules deny it). Prefer
 * claimed/assigned+lat if it returns rows; otherwise cap equality queries.
 */
export async function loadLeadManagementPins(
  user: { id?: string; role?: string } | null | undefined,
  bounds: LeadManagementBounds,
  loaders: LeadManagementPinLoaders,
): Promise<Lead[]> {
  const { south, north, west, east, maxLeads } = bounds;
  if (user?.role === 'admin') {
    return loaders.getLeadsInBounds(south, north, west, east, maxLeads);
  }
  if (!user?.id) return [];
  const inView = await loaders.getLeadsInBoundsForUser(
    user.id,
    south,
    north,
    west,
    east,
    maxLeads,
  );
  if (inView.length > 0) return inView;
  return loaders.getLeadsForUserLimited(user.id, maxLeads);
}

export async function withLoadTimeout<T>(
  promise: Promise<T>,
  label: string,
  ms: number = LEAD_MANAGEMENT_LOAD_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
