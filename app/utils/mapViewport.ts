import type { Lead } from "../types";

export type ViewportBounds = {
  south: number;
  north: number;
  west: number;
  east: number;
};
export function buildLeadViewportIndex(leads: Lead[]) {
  return leads
    .filter((lead) => Number.isFinite(lead.lat) && Number.isFinite(lead.lng))
    .slice()
    .sort((a, b) => a.lat! - b.lat!);
}
export function queryLeadViewport(index: Lead[], bounds: ViewportBounds) {
  let low = 0,
    high = index.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (index[mid].lat! < bounds.south) low = mid + 1;
    else high = mid;
  }
  const found: Lead[] = [];
  for (let i = low; i < index.length && index[i].lat! <= bounds.north; i++) {
    const lead = index[i];
    const lng = lead.lng!;
    if (
      bounds.west <= bounds.east
        ? lng >= bounds.west && lng <= bounds.east
        : lng >= bounds.west || lng <= bounds.east
    )
      found.push(lead);
  }
  return found;
}
