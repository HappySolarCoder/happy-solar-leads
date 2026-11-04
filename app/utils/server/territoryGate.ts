import type { DispoDb, DispoSnap, DispoTransaction } from './fieldDispo';
import { insideTerritory } from '@/app/utils/territoryManager';

export const TERRITORY_QUERY_LIMIT = 200;

export type DispoBlock = 'outside_territory' | 'no_territory' | 'territory_unknown' | 'no_coords';

export type PinTerritoryInput = {
  uid: string;
  role: string;
  lat: unknown;
  lng: unknown;
};

export type PinTerritoryResult =
  | { allowed: true }
  | { allowed: false; dispoBlock: DispoBlock };

export type TerritoryLoad = {
  docs: DispoSnap[];
  truncated: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function polygonOf(value: unknown): Array<{ lat: number; lng: number }> | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const points: Array<{ lat: number; lng: number }> = [];
  for (const point of value) {
    if (!isPlainObject(point)) return null;
    if (typeof point.lat !== 'number' || typeof point.lng !== 'number') return null;
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
    points.push({ lat: point.lat, lng: point.lng });
  }
  return points;
}

export async function loadTerritories(
  db: DispoDb,
  tx: DispoTransaction,
  uid: string,
): Promise<TerritoryLoad> {
  const query = db.collection('territories').where('userId', '==', uid).limit(TERRITORY_QUERY_LIMIT);
  const snap = await tx.getQuery(query);
  const truncated = snap.docs.length >= TERRITORY_QUERY_LIMIT;
  if (truncated) console.log('[field/dispo] territories_truncated 1');
  return { docs: snap.docs, truncated };
}

export function countedPolygons(docs: DispoSnap[], uid: string): Array<Array<{ lat: number; lng: number }>> {
  const polygons: Array<Array<{ lat: number; lng: number }>> = [];
  for (const doc of docs) {
    const data = doc.data() ?? {};
    if (data.userId !== uid || data.archived) continue;
    const polygon = polygonOf(data.polygon);
    if (polygon) polygons.push(polygon);
  }
  return polygons;
}

/**
 * Fail closed. Staff bypass is the only override. Truncation is decided
 * before any polygon is tested, because a capped read cannot prove the pin
 * is outside every territory. The point test is insideTerritory alone.
 */
export function decidePinTerritory(
  loaded: TerritoryLoad,
  input: { uid: string; lat: unknown; lng: unknown },
): PinTerritoryResult {
  if (loaded.truncated) return { allowed: false, dispoBlock: 'territory_unknown' };
  const polygons = countedPolygons(loaded.docs, input.uid);
  if (polygons.length === 0) return { allowed: false, dispoBlock: 'no_territory' };
  const { lat, lng } = input;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { allowed: false, dispoBlock: 'no_coords' };
  }
  if (polygons.some((polygon) => insideTerritory(lat, lng, polygon))) return { allowed: true };
  return { allowed: false, dispoBlock: 'outside_territory' };
}

const territoryLoads = new WeakMap<object, Map<string, Promise<TerritoryLoad>>>();

export async function pinTerritoryGate(
  db: DispoDb,
  tx: DispoTransaction,
  input: PinTerritoryInput,
): Promise<PinTerritoryResult> {
  if (input.role === 'admin' || input.role === 'manager') return { allowed: true };
  let byUid = territoryLoads.get(tx);
  if (!byUid) {
    byUid = new Map();
    territoryLoads.set(tx, byUid);
  }
  let pending = byUid.get(input.uid);
  if (!pending) {
    pending = loadTerritories(db, tx, input.uid);
    byUid.set(input.uid, pending);
  }
  const loaded = await pending;
  return decidePinTerritory(loaded, input);
}
