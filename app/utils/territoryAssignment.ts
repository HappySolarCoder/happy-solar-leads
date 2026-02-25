import { Territory } from '@/app/types/territory';
import { Lead } from '@/app/types';

/**
 * Check if a point is inside a polygon
 */
function isPointInPolygon(lat: number, lng: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][1], yi = polygon[i][0];
    const xj = polygon[j][1], yj = polygon[j][0];
    
    const intersect = ((yi > lat) !== (yj > lat))
        && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Find which territory (if any) a lead belongs to
 * Returns the territory or null
 */
export function findLeadTerritory(lead: Lead, territories: Territory[]): Territory | null {
  if (!lead.lat || !lead.lng) return null;
  
  // Check each territory to see if lead is inside
  for (const territory of territories) {
    if (territory.polygon && territory.polygon.length >= 3) {
      if (isPointInPolygon(lead.lat, lead.lng, territory.polygon)) {
        return territory;
      }
    }
  }
  
  return null;
}

/**
 * Auto-assign leads based on territories
 * Returns array of leads that were updated
 */
export function autoAssignLeadsByTerritories(
  leads: Lead[],
  territories: Territory[]
): { lead: Lead; territory: Territory }[] {
  const assignments: { lead: Lead; territory: Territory }[] = [];
  
  for (const lead of leads) {
    const territory = findLeadTerritory(lead, territories);
    if (territory) {
      // Only assign if not already assigned to someone else
      if (!lead.assignedTo || lead.assignedTo !== territory.userId) {
        assignments.push({ lead, territory });
      }
    }
  }
  
  return assignments;
}
