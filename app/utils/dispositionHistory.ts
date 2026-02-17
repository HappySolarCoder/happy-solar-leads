// Disposition History Utilities
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  limit as firestoreLimit,
  getDocs,
  Timestamp 
} from 'firebase/firestore';
import { db } from './firebase';
import { DispositionHistoryEntry, DispositionHistoryFilters } from '@/app/types/dispositionHistory';

const HISTORY_COLLECTION = 'disposition_history';

/**
 * Record a disposition change in history
 */
export async function recordDispositionChange(
  leadId: string,
  leadAddress: string,
  previousDisposition: string | undefined,
  newDisposition: string,
  userId: string,
  userName: string,
  userRole: string,
  options?: {
    knockGpsLat?: number;
    knockGpsLng?: number;
    knockGpsAccuracy?: number;
    knockDistanceFromAddress?: number;
    objectionType?: string;
    objectionNotes?: string;
    notes?: string;
    source?: 'manual' | 'auto-assignment' | 'claim' | 'admin-action';
  }
): Promise<string> {
  if (!db) {
    throw new Error('Firestore not initialized');
  }

  const historyEntry: Omit<DispositionHistoryEntry, 'id'> = {
    leadId,
    leadAddress,
    previousDisposition,
    newDisposition,
    userId,
    userName,
    userRole,
    createdAt: Timestamp.now() as any,
    ...options,
  };

  const historyRef = collection(db, HISTORY_COLLECTION);
  const docRef = await addDoc(historyRef, historyEntry);
  
  return docRef.id;
}

/**
 * Get disposition history for a lead
 */
export async function getLeadDispositionHistory(
  leadId: string,
  limitCount: number = 50
): Promise<DispositionHistoryEntry[]> {
  if (!db) {
    console.warn('Firestore not initialized');
    return [];
  }

  try {
    const historyRef = collection(db, HISTORY_COLLECTION);
    const q = query(
      historyRef,
      where('leadId', '==', leadId),
      orderBy('createdAt', 'desc'),
      firestoreLimit(limitCount)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id,
      createdAt: doc.data().createdAt?.toDate?.() || new Date(doc.data().createdAt),
    } as DispositionHistoryEntry));
  } catch (error) {
    console.error('Error getting lead disposition history:', error);
    return [];
  }
}

/**
 * Get disposition history for a user
 */
export async function getUserDispositionHistory(
  userId: string,
  limitCount: number = 100
): Promise<DispositionHistoryEntry[]> {
  if (!db) {
    console.warn('Firestore not initialized');
    return [];
  }

  try {
    const historyRef = collection(db, HISTORY_COLLECTION);
    const q = query(
      historyRef,
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      firestoreLimit(limitCount)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id,
      createdAt: doc.data().createdAt?.toDate?.() || new Date(doc.data().createdAt),
    } as DispositionHistoryEntry));
  } catch (error) {
    console.error('Error getting user disposition history:', error);
    return [];
  }
}

/**
 * Get disposition history with filters
 */
export async function getDispositionHistory(
  filters: DispositionHistoryFilters
): Promise<DispositionHistoryEntry[]> {
  if (!db) {
    console.warn('Firestore not initialized');
    return [];
  }

  try {
    const historyRef = collection(db, HISTORY_COLLECTION);
    let q = query(historyRef);

    // Apply filters
    if (filters.leadId) {
      q = query(q, where('leadId', '==', filters.leadId));
    }
    if (filters.userId) {
      q = query(q, where('userId', '==', filters.userId));
    }
    if (filters.disposition) {
      q = query(q, where('newDisposition', '==', filters.disposition));
    }
    if (filters.startDate) {
      q = query(q, where('createdAt', '>=', Timestamp.fromDate(filters.startDate)));
    }
    if (filters.endDate) {
      q = query(q, where('createdAt', '<=', Timestamp.fromDate(filters.endDate)));
    }

    // Order and limit
    q = query(q, orderBy('createdAt', 'desc'));
    if (filters.limit) {
      q = query(q, firestoreLimit(filters.limit));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id,
      createdAt: doc.data().createdAt?.toDate?.() || new Date(doc.data().createdAt),
    } as DispositionHistoryEntry));
  } catch (error) {
    console.error('Error getting disposition history:', error);
    return [];
  }
}
