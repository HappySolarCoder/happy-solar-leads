import { collection, query, where, limit, getDocs, startAfter } from 'firebase/firestore';
import { db } from './firebase';
import { Lead } from '@/app/types';

export type ViewportBox = { south: number; north: number; west: number; east: number };

function leadInViewport(lead: Lead, bounds: ViewportBox): boolean {
  if (lead.lat == null || lead.lng == null) return false;
  if (lead.lat < bounds.south || lead.lat > bounds.north) return false;
  if (bounds.west > bounds.east) {
    return lead.lng >= bounds.west || lead.lng <= bounds.east;
  }
  return lead.lng >= bounds.west && lead.lng <= bounds.east;
}

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

/**
 * Tight cap on existing claimedBy / assignedTo equality queries.
 * Does NOT add lat range (those composite indexes are not on prod).
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

/**
 * Index-free fallback when claimedBy+lat / assignedTo+lat are not built.
 * Pages equality claimedBy/assignedTo (no lat range), keeps only the visible box,
 * up to maxInBounds. Scan cap avoids dumping the full assignment onto the map.
 */
export async function getUserLeadsInViewportFallback(
  uid: string,
  bounds: ViewportBox,
  maxInBounds: number = 400
): Promise<Lead[]> {
  if (!db) {
    console.warn('Firestore not initialized');
    return [];
  }

  const leadsRef = collection(db, 'leads');
  const pageSize = Math.max(400, Math.min(maxInBounds, 800));
  const maxScan = Math.min(8000, Math.max(2000, maxInBounds * 8));

  const pageEquality = async (field: 'claimedBy' | 'assignedTo'): Promise<Lead[]> => {
    const inBounds: Lead[] = [];
    let lastDoc: any = null;
    let scanned = 0;

    while (inBounds.length < maxInBounds && scanned < maxScan) {
      const take = Math.min(pageSize, maxScan - scanned);
      const q = lastDoc
        ? query(leadsRef, where(field, '==', uid), startAfter(lastDoc), limit(take))
        : query(leadsRef, where(field, '==', uid), limit(take));
      const snapshot = await getDocs(q);
      if (snapshot.empty) break;
      scanned += snapshot.docs.length;
      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      for (const d of snapshot.docs) {
        const data = d.data();
        const lead = toThinMapLead({
          ...data,
          id: d.id,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
          claimedAt: data.claimedAt?.toDate ? data.claimedAt.toDate() : (data.claimedAt ? new Date(data.claimedAt) : undefined),
          dispositionedAt: data.dispositionedAt?.toDate ? data.dispositionedAt.toDate() : (data.dispositionedAt ? new Date(data.dispositionedAt) : undefined),
          assignedAt: data.assignedAt?.toDate ? data.assignedAt.toDate() : (data.assignedAt ? new Date(data.assignedAt) : undefined),
          dispositionHistory: data.dispositionHistory?.map((entry: any) => ({
            ...entry,
            timestamp: entry.timestamp?.toDate ? entry.timestamp.toDate() : (entry.timestamp ? new Date(entry.timestamp) : new Date()),
          })) || undefined,
        } as Lead);
        if (leadInViewport(lead, bounds)) {
          inBounds.push(lead);
          if (inBounds.length >= maxInBounds) break;
        }
      }

      if (snapshot.docs.length < take) break;
    }

    return inBounds;
  };

  try {
    const [claimed, assigned] = await Promise.all([
      pageEquality('claimedBy'),
      pageEquality('assignedTo'),
    ]);
    const byId = new Map<string, Lead>();
    for (const lead of claimed) byId.set(lead.id, lead);
    for (const lead of assigned) byId.set(lead.id, lead);
    return Array.from(byId.values()).slice(0, maxInBounds);
  } catch (error) {
    console.error('Error paging user leads in viewport (equality fallback):', error);
    return [];
  }
}
