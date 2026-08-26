// Firestore Database Operations
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
  limit,
  startAfter,
  writeBatch
} from 'firebase/firestore';
import { db } from './firebase';
import { Lead, User } from '@/app/types';

// Collections
const LEADS_COLLECTION = 'leads';
const USERS_COLLECTION = 'users';

// ============================================
// LEADS
// ============================================

function mapLeadDoc(docSnap: any): Lead {
  const data = docSnap.data();
  return {
    ...data,
    id: docSnap.id,
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
    claimedAt: data.claimedAt?.toDate ? data.claimedAt.toDate() : (data.claimedAt ? new Date(data.claimedAt) : undefined),
    dispositionedAt: data.dispositionedAt?.toDate ? data.dispositionedAt.toDate() : (data.dispositionedAt ? new Date(data.dispositionedAt) : undefined),
    assignedAt: data.assignedAt?.toDate ? data.assignedAt.toDate() : (data.assignedAt ? new Date(data.assignedAt) : undefined),
    solarTestedAt: data.solarTestedAt?.toDate ? data.solarTestedAt.toDate() : (data.solarTestedAt ? new Date(data.solarTestedAt) : undefined),
    objectionRecordedAt: data.objectionRecordedAt?.toDate
      ? data.objectionRecordedAt.toDate()
      : (data.objectionRecordedAt ? new Date(data.objectionRecordedAt) : undefined),
    goBackScheduledDate: data.goBackScheduledDate?.toDate
      ? data.goBackScheduledDate.toDate()
      : (data.goBackScheduledDate ? new Date(data.goBackScheduledDate) : undefined),
    dispositionHistory:
      data.dispositionHistory?.map((entry: any) => ({
        ...entry,
        timestamp: entry.timestamp?.toDate ? entry.timestamp.toDate() : (entry.timestamp ? new Date(entry.timestamp) : new Date()),
      })) || undefined,
  } as Lead;
}

export async function getAllLeads(): Promise<Lead[]> {
  if (!db) {
    console.warn('Firestore not initialized');
    return [];
  }
  try {
    const leadsRef = collection(db, LEADS_COLLECTION);
    const snapshot = await getDocs(leadsRef);
    return snapshot.docs.map(mapLeadDoc);
  } catch (error) {
    console.error('Error getting leads:', error);
    return [];
  }
}

export async function getLeadsForUser(uid: string): Promise<Lead[]> {
  if (!db) {
    console.warn('Firestore not initialized');
    return [];
  }

  try {
    const leadsRef = collection(db, LEADS_COLLECTION);

    // Firestore doesn't support OR queries in the simple client SDK without composite indexes,
    // so we do two queries and merge:
    const claimedQ = query(leadsRef, where('claimedBy', '==', uid));
    const assignedQ = query(leadsRef, where('assignedTo', '==', uid));

    const [claimedSnap, assignedSnap] = await Promise.all([getDocs(claimedQ), getDocs(assignedQ)]);

    const byId = new Map<string, Lead>();
    for (const d of claimedSnap.docs) byId.set(d.id, mapLeadDoc(d));
    for (const d of assignedSnap.docs) byId.set(d.id, mapLeadDoc(d));

    return Array.from(byId.values());
  } catch (error) {
    console.error('Error getting leads for user:', error);
    return [];
  }
}

/**
 * Get leads within geographic bounds (for map viewport lazy loading).
 * Firestore can only range-filter one field, so we page the existing lat
 * index and keep docs that also fall in the lng box until we have maxLeads
 * in-bounds pins (or the lat band is exhausted / scan cap).
 * Do NOT take the first N-by-lat then drop all of them on lng.
 */
export async function getLeadsInBounds(
  south: number,
  north: number,
  west: number,
  east: number,
  maxLeads: number = 2000
): Promise<Lead[]> {
  if (!db) {
    console.warn('Firestore not initialized');
    return [];
  }

  try {
    const leadsRef = collection(db, LEADS_COLLECTION);
    const inLng = (lead: Lead) => {
      if (lead.lng == null || !Number.isFinite(Number(lead.lng))) return false;
      if (west > east) {
        return lead.lng >= west || lead.lng <= east;
      }
      return lead.lng >= west && lead.lng <= east;
    };

    // Page the lat index until we have up to maxLeads *in the box*.
    // Scan cap avoids runaway reads on a huge lat band with a thin lng slice.
    const pageSize = Math.max(maxLeads, 400);
    const maxScan = Math.min(8000, Math.max(4000, maxLeads * 8));
    const inBounds: Lead[] = [];
    let lastDoc: any = null;
    let scanned = 0;

    while (inBounds.length < maxLeads && scanned < maxScan) {
      const take = Math.min(pageSize, maxScan - scanned);
      const q = lastDoc
        ? query(
            leadsRef,
            where('lat', '>=', south),
            where('lat', '<=', north),
            orderBy('lat'),
            startAfter(lastDoc),
            limit(take)
          )
        : query(
            leadsRef,
            where('lat', '>=', south),
            where('lat', '<=', north),
            orderBy('lat'),
            limit(take)
          );

      const snapshot = await getDocs(q);
      if (snapshot.empty) break;
      scanned += snapshot.docs.length;
      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      for (const d of snapshot.docs) {
        const lead = mapLeadDoc(d);
        if (inLng(lead)) {
          inBounds.push(lead);
          if (inBounds.length >= maxLeads) break;
        }
      }

      if (snapshot.docs.length < take) break;
    }

    console.log(`[Firestore] Loaded ${inBounds.length} leads in bounds (${south.toFixed(4)}, ${west.toFixed(4)}) to (${north.toFixed(4)}, ${east.toFixed(4)}) after scanning ${scanned}`);

    return inBounds;
  } catch (error) {
    console.error('Error getting leads in bounds:', error);
    return [];
  }
}

export function isMissingIndexError(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | undefined;
  const code = String(err?.code || '');
  const message = String(err?.message || '');
  return (
    code === 'failed-precondition' ||
    /failed-precondition/i.test(code) ||
    /FAILED_PRECONDITION/i.test(message) ||
    /requires an index/i.test(message)
  );
}

function leadInLngBox(lead: Lead, west: number, east: number): boolean {
  if (lead.lng == null || !Number.isFinite(Number(lead.lng))) return false;
  if (west > east) {
    return lead.lng >= west || lead.lng <= east;
  }
  return lead.lng >= west && lead.lng <= east;
}

// Setter/closer viewport query. Needs claimedBy+lat / assignedTo+lat composite indexes
// (defs in firestore.indexes.json; not necessarily built on prod yet).
// Rethrows missing-index errors so callers can fall back without emptying the map.
// Pages the lat band and keeps in-lng docs — do not take first N-by-lat then drop all on lng.
export async function getLeadsInBoundsForUser(
  uid: string,
  south: number,
  north: number,
  west: number,
  east: number,
  maxLeads: number = 2000
): Promise<Lead[]> {
  if (!db) {
    console.warn('Firestore not initialized');
    return [];
  }

  const leadsRef = collection(db, LEADS_COLLECTION);
  const pageSize = Math.max(maxLeads, 400);
  const maxScan = Math.min(8000, Math.max(4000, maxLeads * 8));

  const pageOwnershipLat = async (field: 'claimedBy' | 'assignedTo'): Promise<Lead[]> => {
    const inBounds: Lead[] = [];
    let lastDoc: any = null;
    let scanned = 0;

    while (inBounds.length < maxLeads && scanned < maxScan) {
      const take = Math.min(pageSize, maxScan - scanned);
      const q = lastDoc
        ? query(
            leadsRef,
            where(field, '==', uid),
            where('lat', '>=', south),
            where('lat', '<=', north),
            orderBy('lat'),
            startAfter(lastDoc),
            limit(take)
          )
        : query(
            leadsRef,
            where(field, '==', uid),
            where('lat', '>=', south),
            where('lat', '<=', north),
            orderBy('lat'),
            limit(take)
          );

      const snapshot = await getDocs(q);
      if (snapshot.empty) break;
      scanned += snapshot.docs.length;
      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      for (const d of snapshot.docs) {
        const lead = mapLeadDoc(d);
        if (leadInLngBox(lead, west, east)) {
          inBounds.push(lead);
          if (inBounds.length >= maxLeads) break;
        }
      }

      if (snapshot.docs.length < take) break;
    }

    return inBounds;
  };

  try {
    const [claimed, assigned] = await Promise.all([
      pageOwnershipLat('claimedBy'),
      pageOwnershipLat('assignedTo'),
    ]);

    const byId = new Map<string, Lead>();
    for (const lead of claimed) byId.set(lead.id, lead);
    for (const lead of assigned) byId.set(lead.id, lead);
    return Array.from(byId.values()).slice(0, maxLeads);
  } catch (error) {
    if (!isMissingIndexError(error)) {
      console.error('Error getting leads in bounds for user:', error);
      throw error;
    }
    // Indexes are in firestore.indexes.json but not on prod (do not firebase deploy).
    // Equality scan + in-memory box must not empty the map.
    console.warn('[getLeadsInBoundsForUser] claimedBy+lat/assignedTo+lat missing; equality+bounds fallback');
    const { getUserViewportLeads } = await import('./mapLeadFields');
    return getUserViewportLeads(uid, { south, north, west, east }, maxLeads);
  }
}

export async function getLead(id: string): Promise<Lead | null> {
  if (!db) {
    console.warn('Firestore not initialized');
    return null;
  }
  try {
    const leadRef = doc(db, LEADS_COLLECTION, id);
    const snapshot = await getDoc(leadRef);
    if (snapshot.exists()) {
      const data = snapshot.data();
      return {
        ...data,
        id: snapshot.id,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
        claimedAt: data.claimedAt?.toDate ? data.claimedAt.toDate() : (data.claimedAt ? new Date(data.claimedAt) : undefined),
        dispositionedAt: data.dispositionedAt?.toDate ? data.dispositionedAt.toDate() : (data.dispositionedAt ? new Date(data.dispositionedAt) : undefined),
        assignedAt: data.assignedAt?.toDate ? data.assignedAt.toDate() : (data.assignedAt ? new Date(data.assignedAt) : undefined),
        solarTestedAt: data.solarTestedAt?.toDate ? data.solarTestedAt.toDate() : (data.solarTestedAt ? new Date(data.solarTestedAt) : undefined),
        objectionRecordedAt: data.objectionRecordedAt?.toDate ? data.objectionRecordedAt.toDate() : (data.objectionRecordedAt ? new Date(data.objectionRecordedAt) : undefined),
        goBackScheduledDate: data.goBackScheduledDate?.toDate ? data.goBackScheduledDate.toDate() : (data.goBackScheduledDate ? new Date(data.goBackScheduledDate) : undefined),
        dispositionHistory: data.dispositionHistory?.map((entry: any) => ({
          ...entry,
          timestamp: entry.timestamp?.toDate ? entry.timestamp.toDate() : (entry.timestamp ? new Date(entry.timestamp) : new Date()),
        })) || undefined,
      } as Lead;
    }
    return null;
  } catch (error) {
    console.error('Error getting lead:', error);
    return null;
  }
}

export async function saveLead(lead: Lead): Promise<void> {
  if (!db) {
    console.warn('Firestore not initialized');
    return;
  }
  try {
    const leadRef = doc(db, LEADS_COLLECTION, lead.id);
    
    // Helper to convert any date format to Timestamp
    const toTimestamp = (date: any): Timestamp | null => {
      if (!date) return null;
      if (date instanceof Date) return Timestamp.fromDate(date);
      if (typeof date === 'string') return Timestamp.fromDate(new Date(date));
      return null;
    };
    
    // Helper to remove undefined values (Firestore doesn't accept undefined)
    const cleanObject = (obj: any): any => {
      const cleaned: any = {};
      for (const key in obj) {
        if (obj[key] !== undefined) {
          cleaned[key] = obj[key];
        }
      }
      return cleaned;
    };
    
    const data = cleanObject({
      ...lead,
      createdAt: toTimestamp(lead.createdAt) || Timestamp.now(),
      claimedAt: toTimestamp(lead.claimedAt),
      dispositionedAt: toTimestamp(lead.dispositionedAt),
      assignedAt: toTimestamp(lead.assignedAt),
      solarTestedAt: toTimestamp(lead.solarTestedAt),
      objectionRecordedAt: toTimestamp((lead as any).objectionRecordedAt),
    });
    await setDoc(leadRef, data);
  } catch (error) {
    console.error('Error saving lead:', error);
    throw error;
  }
}

/**
 * Batch save leads in groups of 500 (Firestore limit)
 * Much faster and more reliable for large uploads
 * Returns progress callback for UI updates
 */
export async function batchSaveLeads(
  leads: Lead[],
  onProgress?: (saved: number, total: number) => void
): Promise<void> {
  if (!db) {
    console.warn('Firestore not initialized');
    return;
  }

  const BATCH_SIZE = 500; // Firestore WriteBatch limit
  const totalLeads = leads.length;
  let savedCount = 0;

  // Helper to convert any date format to Timestamp
  const toTimestamp = (date: any): Timestamp | null => {
    if (!date) return null;
    if (date instanceof Date) return Timestamp.fromDate(date);
    if (typeof date === 'string') return Timestamp.fromDate(new Date(date));
    return null;
  };

  // Helper to remove undefined values
  const cleanObject = (obj: any): any => {
    const cleaned: any = {};
    for (const key in obj) {
      if (obj[key] !== undefined) {
        cleaned[key] = obj[key];
      }
    }
    return cleaned;
  };

  try {
    // Process in batches of 500
    for (let i = 0; i < totalLeads; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      const batchLeads = leads.slice(i, Math.min(i + BATCH_SIZE, totalLeads));

      for (const lead of batchLeads) {
        const leadRef = doc(db, LEADS_COLLECTION, lead.id);
        const data = cleanObject({
          ...lead,
          createdAt: toTimestamp(lead.createdAt) || Timestamp.now(),
          claimedAt: toTimestamp(lead.claimedAt),
          dispositionedAt: toTimestamp(lead.dispositionedAt),
          assignedAt: toTimestamp(lead.assignedAt),
          solarTestedAt: toTimestamp(lead.solarTestedAt),
          objectionRecordedAt: toTimestamp((lead as any).objectionRecordedAt),
          knockGpsTimestamp: toTimestamp((lead as any).knockGpsTimestamp),
        });
        batch.set(leadRef, data);
      }

      // Commit this batch
      await batch.commit();
      savedCount += batchLeads.length;

      // Report progress
      if (onProgress) {
        onProgress(savedCount, totalLeads);
      }

      console.log(`[Firestore] Saved batch ${Math.floor(i / BATCH_SIZE) + 1}: ${savedCount}/${totalLeads} leads`);
    }

    console.log(`[Firestore] Successfully saved ${totalLeads} leads in batches`);
  } catch (error) {
    console.error(`[Firestore] Batch save failed at ${savedCount}/${totalLeads}:`, error);
    throw error;
  }
}

export async function updateLead(id: string, updates: Partial<Lead>): Promise<void> {
  if (!db) {
    console.warn('Firestore not initialized');
    return;
  }
  try {
    const leadRef = doc(db, LEADS_COLLECTION, id);
    const data: any = { ...updates };
    
    // Helper to convert any date format to Timestamp
    const toTimestamp = (date: any): Timestamp | null => {
      if (!date) return null;
      if (date instanceof Date) return Timestamp.fromDate(date);
      if (typeof date === 'string') return Timestamp.fromDate(new Date(date));
      return null;
    };
    
    // Convert Date objects to Timestamps
    if (data.createdAt) data.createdAt = toTimestamp(data.createdAt);
    if (data.claimedAt) data.claimedAt = toTimestamp(data.claimedAt);
    if (data.dispositionedAt) data.dispositionedAt = toTimestamp(data.dispositionedAt);
    if (data.assignedAt) data.assignedAt = toTimestamp(data.assignedAt);
    if (data.solarTestedAt) data.solarTestedAt = toTimestamp(data.solarTestedAt);
    if (data.objectionRecordedAt) data.objectionRecordedAt = toTimestamp(data.objectionRecordedAt);
    
    await updateDoc(leadRef, data);
  } catch (error) {
    console.error('Error updating lead:', error);
    throw error;
  }
}

export async function deleteLead(id: string): Promise<void> {
  if (!db) {
    console.warn('Firestore not initialized');
    return;
  }
  try {
    const leadRef = doc(db, LEADS_COLLECTION, id);
    await deleteDoc(leadRef);
  } catch (error) {
    console.error('Error deleting lead:', error);
    throw error;
  }
}

export async function getLeadsByUser(userId: string): Promise<Lead[]> {
  if (!db) {
    console.warn('Firestore not initialized');
    return [];
  }
  try {
    const leadsRef = collection(db, LEADS_COLLECTION);
    const q = query(leadsRef, where('claimedBy', '==', userId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id,
      createdAt: doc.data().createdAt?.toDate() || new Date(),
      claimedAt: doc.data().claimedAt?.toDate(),
      dispositionedAt: doc.data().dispositionedAt?.toDate(),
      assignedAt: doc.data().assignedAt?.toDate(),
      solarTestedAt: doc.data().solarTestedAt?.toDate(),
    } as Lead));
  } catch (error) {
    console.error('Error getting user leads:', error);
    return [];
  }
}

// ============================================
// USERS
// ============================================

export async function getAllUsers(): Promise<User[]> {
  if (!db) {
    const error = new Error('Firestore not initialized');
    console.error('[getAllUsers] Failed to load users collection:', error);
    throw error;
  }
  try {
    const usersRef = collection(db, USERS_COLLECTION);
    const snapshot = await getDocs(usersRef);
    return snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        ...data,
        id: docSnap.id,
        createdAt: data.createdAt?.toDate
          ? data.createdAt.toDate()
          : (data.createdAt ? new Date(data.createdAt) : new Date()),
        lastLogin: data.lastLogin?.toDate
          ? data.lastLogin.toDate()
          : (data.lastLogin ? new Date(data.lastLogin) : undefined),
        approvalRequestedAt: data.approvalRequestedAt?.toDate?.() || data.approvalRequestedAt,
      } as User;
    });
  } catch (error) {
    console.error('[getAllUsers] Failed to load users collection:', error);
    throw error;
  }
}

export async function getUser(id: string): Promise<User | null> {
  if (!db) {
    console.warn('Firestore not initialized');
    return null;
  }
  try {
    const userRef = doc(db, USERS_COLLECTION, id);
    const snapshot = await getDoc(userRef);
    if (snapshot.exists()) {
      const data = snapshot.data();
      return {
        ...data,
        id: snapshot.id,
        createdAt: data.createdAt?.toDate
          ? data.createdAt.toDate()
          : (data.createdAt ? new Date(data.createdAt) : new Date()),
        lastLogin: data.lastLogin?.toDate
          ? data.lastLogin.toDate()
          : (data.lastLogin ? new Date(data.lastLogin) : undefined),
        approvalRequestedAt: data.approvalRequestedAt?.toDate?.() || data.approvalRequestedAt,
      } as User;
    }
    return null;
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
}

export async function saveUser(user: User): Promise<void> {
  if (!db) {
    console.warn('Firestore not initialized');
    return;
  }
  try {
    const userRef = doc(db, USERS_COLLECTION, user.id);
    const data: any = {
      ...user,
      createdAt: user.createdAt instanceof Date ? Timestamp.fromDate(user.createdAt) : Timestamp.now(),
      lastLogin: user.lastLogin ? Timestamp.fromDate(user.lastLogin) : null,
      approvalRequestedAt: user.approvalRequestedAt ? Timestamp.fromDate(user.approvalRequestedAt) : null,
    };
    
    // Remove undefined fields (Firestore doesn't allow them)
    Object.keys(data).forEach(key => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });
    
    await setDoc(userRef, data, { merge: true });
  } catch (error) {
    console.error('Error saving user:', error);
    throw error;
  }
}

export async function updateUser(id: string, updates: Partial<User>): Promise<void> {
  if (!db) {
    console.warn('Firestore not initialized');
    return;
  }
  try {
    const userRef = doc(db, USERS_COLLECTION, id);
    const data: any = { ...updates };
    
    if (data.lastLogin) data.lastLogin = Timestamp.fromDate(data.lastLogin);
    if (data.approvalRequestedAt) data.approvalRequestedAt = Timestamp.fromDate(data.approvalRequestedAt);
    
    // Remove undefined fields (Firestore doesn't allow them)
    Object.keys(data).forEach(key => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });
    
    await updateDoc(userRef, data);
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
}

export async function deleteUser(id: string): Promise<void> {
  if (!db) {
    console.warn('Firestore not initialized');
    return;
  }
  try {
    const userRef = doc(db, USERS_COLLECTION, id);
    await deleteDoc(userRef);
  } catch (error) {
    console.error('Error deleting user:', error);
    throw error;
  }
}

// ============================================
// MIGRATION HELPERS
// ============================================

export async function migrateFromLocalStorage(): Promise<void> {
  console.log('Starting migration from localStorage to Firestore...');
  
  try {
    // Get data from localStorage
    const leadsData = localStorage.getItem('raydar_leads');
    const usersData = localStorage.getItem('raydar_users');
    const currentUserData = localStorage.getItem('raydar_current_user');
    
    if (leadsData) {
      const leads: Lead[] = JSON.parse(leadsData);
      console.log(`Migrating ${leads.length} leads...`);
      for (const lead of leads) {
        await saveLead(lead);
      }
      console.log('Leads migrated successfully');
    }
    
    if (usersData) {
      const users: User[] = JSON.parse(usersData);
      console.log(`Migrating ${users.length} users...`);
      for (const user of users) {
        await saveUser(user);
      }
      console.log('Users migrated successfully');
    }
    
    console.log('Migration complete!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}
