import { collection, query, where, limit, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { Lead } from '@/app/types';

export type MapBounds = { south: number; north: number; west: number; east: number };

/** Pin-critical fields only — keep map state small without new Firestore indexes. */
export function toThinMapLead(lead: Lead): Lead {
  return {
    id: lead.id,
    lat: lead.lat,
    lng: lead.lng,
    status: lead.status,
    name: lead.name,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    solarCategory: lead.solarCategory,
    solarScore: lead.solarScore,
    claimedBy: lead.claimedBy,
    assignedTo: lead.assignedTo,
    leadType: lead.leadType,
    source: lead.source,
    tags: lead.tags,
    disposition: lead.disposition,
    dispositionedAt: lead.dispositionedAt,
    dispositionHistory: lead.dispositionHistory,
    customerFirstName: (lead as any).customerFirstName,
    customerLastName: (lead as any).customerLastName,
    phone: lead.phone,
    createdAt: lead.createdAt,
  } as Lead;
}

function leadInBounds(lead: Lead, bounds: MapBounds): boolean {
  if (lead.lat == null || lead.lng == null) return false;
  if (!Number.isFinite(Number(lead.lat)) || !Number.isFinite(Number(lead.lng))) return false;
  if (lead.lat < bounds.south || lead.lat > bounds.north) return false;
  if (bounds.west > bounds.east) {
    return lead.lng >= bounds.west || lead.lng <= bounds.east;
  }
  return lead.lng >= bounds.west && lead.lng <= bounds.east;
}

/**
 * Tight cap on existing claimedBy / assignedTo equality queries.
 * Does NOT add lat range (those composite indexes are not on prod).
 * Not the field-map path — maps use getUserViewportLeads.
 */
export async function getLeadsForUserLimited(uid: string, maxLeads: number = 400): Promise<Lead[]> {
  if (!db) {
    console.warn('Firestore not initialized');
    return [];
  }

  try {
    const leadsRef = collection(db, 'leads');
    const claimedQ = query(leadsRef, where('claimedBy', '==', uid), limit(maxLeads));
    const assignedQ = query(leadsRef, where('assignedTo', '==', uid), limit(maxLeads));
    const [claimedSnap, assignedSnap] = await Promise.all([getDocs(claimedQ), getDocs(assignedQ)]);

    const byId = new Map<string, Lead>();
    const add = (docSnap: any) => {
      const data = docSnap.data();
      const lead = {
        ...data,
        id: docSnap.id,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
        claimedAt: data.claimedAt?.toDate ? data.claimedAt.toDate() : (data.claimedAt ? new Date(data.claimedAt) : undefined),
        dispositionedAt: data.dispositionedAt?.toDate ? data.dispositionedAt.toDate() : (data.dispositionedAt ? new Date(data.dispositionedAt) : undefined),
        assignedAt: data.assignedAt?.toDate ? data.assignedAt.toDate() : (data.assignedAt ? new Date(data.assignedAt) : undefined),
        dispositionHistory: data.dispositionHistory?.map((entry: any) => ({
          ...entry,
          timestamp: entry.timestamp?.toDate ? entry.timestamp.toDate() : (entry.timestamp ? new Date(entry.timestamp) : new Date()),
        })) || undefined,
      } as Lead;
      byId.set(docSnap.id, toThinMapLead(lead));
    };
    for (const d of claimedSnap.docs) add(d);
    for (const d of assignedSnap.docs) add(d);
    return Array.from(byId.values());
  } catch (error) {
    console.error('Error getting limited leads for user:', error);
    return [];
  }
}

const USER_TURF_SCAN_CAP = 4000;
const USER_TURF_TTL = 90_000;

let userTurfCache: { uid: string; leads: Lead[]; ts: number } | null = null;
let userTurfInflight: { uid: string; promise: Promise<Lead[]> } | null = null;
let userTurfEpoch = 0;

async function loadUserTurfCached(uid: string): Promise<Lead[]> {
  if (userTurfCache && userTurfCache.uid === uid && Date.now() - userTurfCache.ts < USER_TURF_TTL) {
    return userTurfCache.leads;
  }
  if (userTurfInflight && userTurfInflight.uid === uid) {
    return userTurfInflight.promise;
  }

  const epoch = userTurfEpoch;
  const promise = (async () => {
    if (!db) {
      console.warn('Firestore not initialized');
      return [];
    }
    const leadsRef = collection(db, 'leads');
    const claimedQ = query(leadsRef, where('claimedBy', '==', uid), limit(USER_TURF_SCAN_CAP));
    const assignedQ = query(leadsRef, where('assignedTo', '==', uid), limit(USER_TURF_SCAN_CAP));
    const [claimedSnap, assignedSnap] = await Promise.all([getDocs(claimedQ), getDocs(assignedQ)]);
    const byId = new Map<string, Lead>();
    const add = (docSnap: any) => {
      const data = docSnap.data();
      const lead = {
        ...data,
        id: docSnap.id,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
        claimedAt: data.claimedAt?.toDate ? data.claimedAt.toDate() : (data.claimedAt ? new Date(data.claimedAt) : undefined),
        dispositionedAt: data.dispositionedAt?.toDate ? data.dispositionedAt.toDate() : (data.dispositionedAt ? new Date(data.dispositionedAt) : undefined),
        assignedAt: data.assignedAt?.toDate ? data.assignedAt.toDate() : (data.assignedAt ? new Date(data.assignedAt) : undefined),
        dispositionHistory: data.dispositionHistory?.map((entry: any) => ({
          ...entry,
          timestamp: entry.timestamp?.toDate ? entry.timestamp.toDate() : (entry.timestamp ? new Date(entry.timestamp) : new Date()),
        })) || undefined,
      } as Lead;
      byId.set(docSnap.id, toThinMapLead(lead));
    };
    for (const d of claimedSnap.docs) add(d);
    for (const d of assignedSnap.docs) add(d);
    const leads = Array.from(byId.values());
    if (epoch === userTurfEpoch) {
      userTurfCache = { uid, leads, ts: Date.now() };
      console.log(`[MapLeads] Cached ${leads.length} claimed+assigned for ${uid} (equality scan cap ${USER_TURF_SCAN_CAP}/field; no claimedBy+lat index)`);
    }
    return leads;
  })();

  userTurfInflight = { uid, promise };
  promise.finally(() => {
    if (userTurfInflight?.uid === uid) userTurfInflight = null;
  });
  return promise;
}

/**
 * Viewport pins for setter/closer without claimedBy+lat / assignedTo+lat
 * (those indexes are in firestore.indexes.json but not on prod; do not firebase deploy).
 * Scan a capped slice of the user's turf once, cache it, filter to the visible box.
 * Tight cap per viewport is fine; this is not a hard 400 on the whole turf and
 * not an unbounded dump onto the map.
 */
/** Just-saved pins. Refetch/turf TTL must not paint over these. */
const pendingSavedLeads = new Map<string, Lead>();

export function invalidateUserTurfCache(): void {
  userTurfEpoch += 1;
  userTurfCache = null;
  userTurfInflight = null;
  pendingSavedLeads.clear();
}

export function rememberSavedLead(lead: Lead): void {
  const thin = toThinMapLead(lead);
  pendingSavedLeads.set(lead.id, thin);
  if (!userTurfCache) return;
  const idx = userTurfCache.leads.findIndex((l) => l.id === lead.id);
  const leads = userTurfCache.leads.slice();
  if (idx >= 0) leads[idx] = { ...leads[idx], ...thin };
  else leads.push(thin);
  userTurfCache = { ...userTurfCache, leads };
}

export function mergePendingSavedLeads(leads: Lead[], bounds?: MapBounds | null): Lead[] {
  if (pendingSavedLeads.size === 0) return leads;
  const byId = new Map(leads.map((l) => [l.id, l]));
  for (const [id, lead] of pendingSavedLeads) {
    if (byId.has(id)) {
      pendingSavedLeads.delete(id);
      continue;
    }
    if (bounds && !leadInBounds(lead, bounds)) continue;
    byId.set(id, lead);
  }
  return Array.from(byId.values());
}

export async function getUserViewportLeads(
  uid: string,
  bounds: MapBounds,
  maxLeads: number = 400
): Promise<Lead[]> {
  try {
    const turf = await loadUserTurfCached(uid);
    return turf.filter((lead) => leadInBounds(lead, bounds)).slice(0, maxLeads);
  } catch (error) {
    console.error('Error getting user viewport leads:', error);
    return [];
  }
}
