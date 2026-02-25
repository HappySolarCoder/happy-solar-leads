import { Territory, TerritoryPoint } from '@/app/types/territory';
import { Lead } from '@/app/types';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point, polygon } from '@turf/helpers';

/**
 * Compute bounding box of a polygon
 */
function getBoundingBox(polygonCoords: TerritoryPoint[]): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const lats = polygonCoords.map(p => p.lat);
  const lngs = polygonCoords.map(p => p.lng);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}

/**
 * Check if a point is inside a polygon using Turf.js
 * Falls back to bounding box check for complex polygons
 */
function isPointInPolygon(lat: number, lng: number, polygonCoords: TerritoryPoint[]): boolean {
  try {
    // First try with the actual polygon
    // The polygon coordinates need to be closed (first point = last point)
    const coords = polygonCoords.map(p => [p.lng, p.lat]);
    
    // Close the polygon if not already closed
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coords.push(first);
    }
    
    const turfPolygon = polygon([coords]);
    const turfPoint = point([lng, lat]); // Turf uses [lng, lat] order
    
    const result = booleanPointInPolygon(turfPoint, turfPolygon);
    
    // If false, check if it's within the bounding box (for complex zigzag polygons)
    if (!result) {
      const bbox = getBoundingBox(polygonCoords);
      if (lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng) {
        // Within bounding box - use a simpler approach: check if point is on any line segment
        // This handles the zigzag fill pattern by checking if the point falls on any boundary line
        return isPointOnPolygonBoundary(lat, lng, polygonCoords);
      }
    }
    
    return result;
  } catch (error) {
    console.error('[territoryAssignment] Error in point-in-polygon:', error);
    // Fallback to bounding box
    const bbox = getBoundingBox(polygonCoords);
    return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
  }
}

/**
 * Check if point is on or near the polygon boundary
 * This handles zigzag/scanline filled polygons
 */
function isPointOnPolygonBoundary(lat: number, lng: number, polygonCoords: TerritoryPoint[]): boolean {
  const threshold = 0.001; // About 100 meters
  
  for (let i = 0; i < polygonCoords.length - 1; i++) {
    const p1 = polygonCoords[i];
    const p2 = polygonCoords[i + 1];
    
    // Check if point is near this line segment
    const dist = pointToLineDistance(lat, lng, p1.lat, p1.lng, p2.lat, p2.lng);
    if (dist < threshold) {
      return true;
    }
  }
  
  // If not on boundary, check if it's inside using a simpler ray-cast on just the unique vertices
  // Get unique vertices to form a simpler polygon
  const uniquePoints = polygonCoords.filter((p, i, arr) => 
    i === 0 || p.lat !== arr[i-1].lat || p.lng !== arr[i-1].lng
  );
  
  if (uniquePoints.length >= 3) {
    return isPointInSimplePolygon(lat, lng, uniquePoints);
  }
  
  return false;
}

/**
 * Simple point in polygon using ray casting
 */
function isPointInSimplePolygon(lat: number, lng: number, polygonCoords: TerritoryPoint[]): boolean {
  let inside = false;
  const n = polygonCoords.length;
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygonCoords[i].lng, yi = polygonCoords[i].lat;
    const xj = polygonCoords[j].lng, yj = polygonCoords[j].lat;
    
    const intersect = ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  
  return inside;
}

/**
 * Distance from point to line segment
 */
function pointToLineDistance(lat: number, lng: number, x1: number, y1: number, x2: number, y2: number): number {
  const A = lat - x1;
  const B = lng - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  
  if (lenSq !== 0) param = dot / lenSq;
  
  let xx, yy;
  
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }
  
  const dx = lat - xx;
  const dy = lng - yy;
  
  return Math.sqrt(dx * dx + dy * dy);
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
