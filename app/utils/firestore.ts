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
  Timestamp
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
    console.error('Error getting leads:', error);
    return [];
  }
}

export async function getLead(id: string): Promise<Lead | null> {
  try {
    const leadRef = doc(db, LEADS_COLLECTION, id);
    const snapshot = await getDoc(leadRef);
    if (snapshot.exists()) {
      const data = snapshot.data();
      return {
        ...data,
        id: snapshot.id,
        createdAt: data.createdAt?.toDate() || new Date(),
        claimedAt: data.claimedAt?.toDate(),
        dispositionedAt: data.dispositionedAt?.toDate(),
        assignedAt: data.assignedAt?.toDate(),
        solarTestedAt: data.solarTestedAt?.toDate(),
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
    const data = {
      ...lead,
      createdAt: lead.createdAt instanceof Date ? Timestamp.fromDate(lead.createdAt) : Timestamp.now(),
      claimedAt: lead.claimedAt ? Timestamp.fromDate(lead.claimedAt) : null,
      dispositionedAt: lead.dispositionedAt ? Timestamp.fromDate(lead.dispositionedAt) : null,
      assignedAt: lead.assignedAt ? Timestamp.fromDate(lead.assignedAt) : null,
      solarTestedAt: lead.solarTestedAt ? Timestamp.fromDate(lead.solarTestedAt) : null,
    };
    await setDoc(leadRef, data);
  } catch (error) {
    console.error('Error saving lead:', error);
    throw error;
  }
}

export async function updateLead(id: string, updates: Partial<Lead>): Promise<void> {
  try {
    const leadRef = doc(db, LEADS_COLLECTION, id);
    const data: any = { ...updates };
    
    // Convert Date objects to Timestamps
    if (data.claimedAt) data.claimedAt = Timestamp.fromDate(data.claimedAt);
    if (data.dispositionedAt) data.dispositionedAt = Timestamp.fromDate(data.dispositionedAt);
    if (data.assignedAt) data.assignedAt = Timestamp.fromDate(data.assignedAt);
    if (data.solarTestedAt) data.solarTestedAt = Timestamp.fromDate(data.solarTestedAt);
    
    await updateDoc(leadRef, data);
  } catch (error) {
    console.error('Error updating lead:', error);
    throw error;
  }
}

export async function deleteLead(id: string): Promise<void> {
  try {
    const leadRef = doc(db, LEADS_COLLECTION, id);
    await deleteDoc(leadRef);
  } catch (error) {
    console.error('Error deleting lead:', error);
    throw error;
  }
}

export async function getLeadsByUser(userId: string): Promise<Lead[]> {
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
    } as User));
  } catch (error) {
    console.error('Error getting users:', error);
    return [];
  }
}

export async function getUser(id: string): Promise<User | null> {
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
      } as User;
    }
    return null;
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
}

export async function saveUser(user: User): Promise<void> {
  try {
    const userRef = doc(db, USERS_COLLECTION, user.id);
    const data = {
      ...user,
      createdAt: user.createdAt instanceof Date ? Timestamp.fromDate(user.createdAt) : Timestamp.now(),
      lastLogin: user.lastLogin ? Timestamp.fromDate(user.lastLogin) : null,
    };
    await setDoc(userRef, data);
  } catch (error) {
    console.error('Error saving user:', error);
    throw error;
  }
}

export async function updateUser(id: string, updates: Partial<User>): Promise<void> {
  try {
    const userRef = doc(db, USERS_COLLECTION, id);
    const data: any = { ...updates };
    
    if (data.lastLogin) data.lastLogin = Timestamp.fromDate(data.lastLogin);
    
    await updateDoc(userRef, data);
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
}

export async function deleteUser(id: string): Promise<void> {
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
    const leadsData = localStorage.getItem('happysolar_leads');
    const usersData = localStorage.getItem('happysolar_users');
    const currentUserData = localStorage.getItem('happysolar_current_user');
    
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
