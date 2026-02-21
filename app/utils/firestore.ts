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

export async function getAllLeads(): Promise<Lead[]> {
  if (!db) {
    console.warn('Firestore not initialized');
    return [];
  }
  try {
    const leadsRef = collection(db, LEADS_COLLECTION);
    const snapshot = await getDocs(leadsRef);
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
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
    });
  } catch (error) {
    console.error('Error getting leads:', error);
    return [];
  }
}

/**
 * Get leads within geographic bounds (for map viewport lazy loading)
 * This dramatically reduces read operations by only loading visible leads
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
    
    // Query leads within latitude bounds
    // Note: Firestore doesn't support compound geo queries, so we filter by lat first
    // then filter lng in memory
    const q = query(
      leadsRef,
      where('lat', '>=', south),
      where('lat', '<=', north),
      limit(maxLeads)
    );
    
    const snapshot = await getDocs(q);
    const allLeads = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
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
    });
    
    // Filter by longitude in memory (Firestore doesn't support multiple range queries)
    const leadsInBounds = allLeads.filter(lead => {
      if (!lead.lng) return false;
      
      // Handle longitude wraparound at date line
      if (west > east) {
        // Bounds cross date line
        return lead.lng >= west || lead.lng <= east;
      } else {
        return lead.lng >= west && lead.lng <= east;
      }
    });
    
    console.log(`[Firestore] Loaded ${leadsInBounds.length} leads in bounds (${south.toFixed(4)}, ${west.toFixed(4)}) to (${north.toFixed(4)}, ${east.toFixed(4)})`);
    
    return leadsInBounds;
  } catch (error) {
    console.error('Error getting leads in bounds:', error);
    return [];
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
    console.warn('Firestore not initialized');
    return [];
  }
  try {
    const usersRef = collection(db, USERS_COLLECTION);
    const snapshot = await getDocs(usersRef);
    return snapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id,
      createdAt: doc.data().createdAt?.toDate() || new Date(),
      lastLogin: doc.data().lastLogin?.toDate(),
      approvalRequestedAt: doc.data().approvalRequestedAt?.toDate?.() || doc.data().approvalRequestedAt,
    } as User));
  } catch (error) {
    console.error('Error getting users:', error);
    return [];
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
        createdAt: data.createdAt?.toDate() || new Date(),
        lastLogin: data.lastLogin?.toDate(),
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
    const data = {
      ...user,
      createdAt: user.createdAt instanceof Date ? Timestamp.fromDate(user.createdAt) : Timestamp.now(),
      lastLogin: user.lastLogin ? Timestamp.fromDate(user.lastLogin) : null,
      approvalRequestedAt: user.approvalRequestedAt ? Timestamp.fromDate(user.approvalRequestedAt) : null,
    };
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
