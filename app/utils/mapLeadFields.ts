import { collection, query, where, limit, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { Lead } from '@/app/types';

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
