import { collection, addDoc, getDocs, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { db } from './firebase';
import { Territory, TerritoryPoint } from '@/app/types/territory';

function toIsoCreatedAt(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const parsed = (value as { toDate: () => Date }).toDate();
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  throw new Error('Territory createdAt is not a valid date');
}

function cleanTerritoryWrite(obj: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) cleaned[key] = value;
  }
  return cleaned;
}

/** Accept iPad/Leaflet [lat,lng] pairs or {lat,lng} objects. Drop undefined/NaN. */
export function normalizeTerritoryPolygon(polygon: unknown): TerritoryPoint[] {
  if (!Array.isArray(polygon)) return [];
  const out: TerritoryPoint[] = [];
  for (const point of polygon) {
    let lat: number = NaN;
    let lng: number = NaN;
    if (Array.isArray(point) && point.length >= 2) {
      lat = Number(point[0]);
      lng = Number(point[1]);
    } else if (point && typeof point === 'object') {
      const rec = point as { lat?: unknown; lng?: unknown };
      lat = Number(rec.lat);
      lng = Number(rec.lng);
    }
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      out.push({ lat, lng });
    }
  }
  return out;
}

export async function saveTerritory(territory: Omit<Territory, 'id'>): Promise<string> {
  if (!db) throw new Error('Firestore not initialized');

  const polygon = normalizeTerritoryPolygon(territory.polygon);
  if (polygon.length < 3) {
    throw new Error('Territory polygon must have at least 3 valid lat/lng points');
  }

  // Empty leadIds is valid — Filter-by-user can be 0-in-view while the polygon still saves.
  const leadIds = (territory.leadIds || []).filter(
    (id): id is string => typeof id === 'string' && id.trim().length > 0,
  );

  // Explicit fields only — do not spread Date/undefined extras (Firestore rejects both).
  const firestoreData = cleanTerritoryWrite({
    userId: territory.userId,
    userName: territory.userName || territory.userId,
    userColor: territory.userColor || '#6b7280',
    polygon,
    leadIds,
    createdAt: toIsoCreatedAt(territory.createdAt),
    createdBy: territory.createdBy || 'unknown',
  });

  const docRef = await addDoc(collection(db, 'territories'), firestoreData);
  return docRef.id;
}

export async function getTerritoriesAsync(): Promise<Territory[]> {
  if (!db) return [];
  
  try {
    const territoriesRef = collection(db, 'territories');
    const q = query(territoriesRef, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: new Date(doc.data().createdAt),
    })) as Territory[];
  } catch (error) {
    console.error('Error loading territories:', error);
    return [];
  }
}

export async function deleteTerritoryAsync(id: string): Promise<void> {
  if (!db) throw new Error('Firestore not initialized');
  
  const territoryRef = doc(db, 'territories', id);
  await deleteDoc(territoryRef);
}

export async function deleteTerritoriesByUserAsync(userId: string): Promise<void> {
  if (!db) return;
  
  const territories = await getTerritoriesAsync();
  const userTerritories = territories.filter(t => t.userId === userId);
  
  for (const territory of userTerritories) {
    await deleteTerritoryAsync(territory.id);
  }
}
