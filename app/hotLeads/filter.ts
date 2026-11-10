import type { Lead } from "@/app/types";
import { canSeeHotLeads, type HotLeadProfile } from "./access";
import { HOT_LEADS_ENABLED } from "./flag";
import { isHotLead, isHotOnlyLead, type HotDisplayLead } from "./model";

export type HotPinFilter = "all" | "only" | "hide";
export const HOT_LEAD_LEGEND = "3PL lead";
export const HOT_FILTER_STORAGE_PREFIX = "raydar.hotFilter.v1:";
export const HOT_LEAD_MIN_ZOOM = 15;
export const HOT_LEAD_ZOOM_BANNER = "Zoom in to see 3PL leads.";
export const HOT_FILTER_BADGE = "3PL";

export function hotFilterStorageKey(uid: string): string {
  return `${HOT_FILTER_STORAGE_PREFIX}${uid}`;
}

type FilterStorage = {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
};

export function readHotFilter(uid: string | null | undefined, storage?: FilterStorage | null): HotPinFilter {
  if (!uid || !storage?.getItem) return "all";
  try {
    const value = storage.getItem(hotFilterStorageKey(uid));
    if (value === "all" || value === "only" || value === "hide") return value;
  } catch {
    /* Private mode and blocked storage keep the default. */
  }
  return "all";
}

export function writeHotFilter(
  uid: string | null | undefined,
  filter: HotPinFilter,
  storage?: FilterStorage | null,
): void {
  if (!uid || !storage?.setItem) return;
  try {
    storage.setItem(hotFilterStorageKey(uid), filter);
  } catch {
    /* The choice still applies for this visit. */
  }
}

export type HotOnlyLayers = {
  homeowners: boolean;
  heat: boolean;
  teamMembers: boolean;
  otherTerritories: boolean;
};

/** Null unless this rep can see the filter and chose 3PL only. Callers then hide the other layers. */
export function hotOnlyLayers(filter: HotPinFilter, visible: boolean): HotOnlyLayers | null {
  if (!(visible && filter === "only")) return null;
  return { homeowners: false, heat: false, teamMembers: false, otherTerritories: false };
}

/** "3PL only" below the fetch zoom shows the banner and no pins. A ready overview hides the banner. */
export function hotLeadZoomBanner(
  filter: HotPinFilter,
  zoom: number | null | undefined,
  overviewReady = false,
): string | null {
  if (overviewReady) return null;
  if (filter !== "only") return null;
  if (typeof zoom !== "number" || !Number.isFinite(zoom) || zoom >= HOT_LEAD_MIN_ZOOM) return null;
  return HOT_LEAD_ZOOM_BANNER;
}

export function hotLeadFilterVisible(
  user: HotLeadProfile | null | undefined,
  enabled = HOT_LEADS_ENABLED,
  roles?: readonly string[],
): boolean {
  return enabled && canSeeHotLeads(user, roles);
}

function stripHot(lead: Lead): Lead {
  if (!isHotLead(lead)) return lead;
  const copy: HotDisplayLead = { ...lead };
  delete copy.hotLead;
  delete copy.hotOnly;
  delete copy.hotLeadId;
  delete copy.hotPin;
  return copy;
}

/** Hide keeps the house pin and drops the halo. Only keeps hot pins. */
export function applyHotFilter(leads: readonly Lead[], filter: HotPinFilter): Lead[] {
  if (filter === "only") return leads.filter((lead) => isHotLead(lead));
  if (filter === "hide") return leads.filter((lead) => !isHotOnlyLead(lead)).map(stripHot);
  return leads as Lead[];
}
