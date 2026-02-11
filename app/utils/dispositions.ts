// Disposition Storage (Firestore)
import { db } from './firebase';
import { collection, getDocs, doc, setDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { Disposition, DEFAULT_DISPOSITIONS } from '@/app/types/disposition';

// Re-export Disposition type for convenience
export type { Disposition } from '@/app/types/disposition';

const DISPOSITIONS_COLLECTION = 'dispositions';

// Get all dispositions (with defaults as fallback)
export async function getDispositionsAsync(): Promise<Disposition[]> {
  try {
    if (typeof window === 'undefined' || !db) {
      return DEFAULT_DISPOSITIONS;
    }

    const q = query(collection(db, DISPOSITIONS_COLLECTION), orderBy('order', 'asc'));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      // First time - initialize with defaults
      await initializeDefaultDispositions();
      return DEFAULT_DISPOSITIONS;
    }
    
    const dispositions = snapshot.docs.map(doc => ({
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || new Date(),
      updatedAt: doc.data().updatedAt?.toDate?.() || new Date(),
    })) as Disposition[];
    
    return dispositions;
  } catch (error) {
    console.error('Error loading dispositions:', error);
    return DEFAULT_DISPOSITIONS;
  }
}

// Initialize default dispositions in Firestore
export async function initializeDefaultDispositions(): Promise<void> {
  try {
    if (!db) return;
    
    for (const dispo of DEFAULT_DISPOSITIONS) {
      await setDoc(doc(db, DISPOSITIONS_COLLECTION, dispo.id), {
        ...dispo,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  } catch (error) {
    console.error('Error initializing dispositions:', error);
  }
}

// Save disposition (create or update)
export async function saveDispositionAsync(disposition: Disposition): Promise<void> {
  try {
    if (!db) throw new Error('Firebase not initialized');
    
    // Clean undefined fields (Firestore doesn't accept undefined)
    const cleanData: any = {
      id: disposition.id,
      name: disposition.name,
      color: disposition.color,
      icon: disposition.icon,
      countsAsDoorKnock: disposition.countsAsDoorKnock,
      order: disposition.order,
      isDefault: disposition.isDefault,
      createdAt: disposition.createdAt,
      updatedAt: new Date(),
    };
    
    // Only add specialBehavior if it's defined
    if (disposition.specialBehavior) {
      cleanData.specialBehavior = disposition.specialBehavior;
    }
    
    await setDoc(doc(db, DISPOSITIONS_COLLECTION, disposition.id), cleanData);
  } catch (error) {
    console.error('Error saving disposition:', error);
    throw error;
  }
}

// Delete disposition (admin can delete any disposition)
export async function deleteDispositionAsync(id: string): Promise<void> {
  try {
    if (!db) throw new Error('Firebase not initialized');
    
    await deleteDoc(doc(db, DISPOSITIONS_COLLECTION, id));
  } catch (error) {
    console.error('Error deleting disposition:', error);
    throw error;
  }
}

// Update disposition order (for drag-and-drop)
export async function updateDispositionOrderAsync(dispositions: Disposition[]): Promise<void> {
  try {
    if (!db) throw new Error('Firebase not initialized');
    
    // Update order field for each disposition
    const updates = dispositions.map((dispo, index) => {
      if (!db) return Promise.resolve();
      return setDoc(doc(db, DISPOSITIONS_COLLECTION, dispo.id), {
        ...dispo,
        order: index,
        updatedAt: new Date(),
      });
    });
    
    await Promise.all(updates);
  } catch (error) {
    console.error('Error updating disposition order:', error);
    throw error;
  }
}

// Generate unique ID for new disposition
export function generateDispositionId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Get disposition by ID
export async function getDispositionByIdAsync(id: string): Promise<Disposition | null> {
  const dispositions = await getDispositionsAsync();
  return dispositions.find(d => d.id === id) || null;
}

// Get door knock count (dispositions that count as door knocks)
export async function getDoorKnockDispositionsAsync(): Promise<Disposition[]> {
  const dispositions = await getDispositionsAsync();
  return dispositions.filter(d => d.countsAsDoorKnock);
}

// Utility: Get disposition color by ID
export async function getDispositionColorAsync(statusId: string): Promise<string> {
  const disposition = await getDispositionByIdAsync(statusId);
  return disposition?.color || '#6B7280'; // Default gray if not found
}

// Utility: Get disposition name by ID
export async function getDispositionNameAsync(statusId: string): Promise<string> {
  const disposition = await getDispositionByIdAsync(statusId);
  return disposition?.name || statusId;
}

// Utility: Get disposition icon by ID
export async function getDispositionIconAsync(statusId: string): Promise<string> {
  const disposition = await getDispositionByIdAsync(statusId);
  return disposition?.icon || 'circle';
}

// Utility: Create a dispositions map for quick lookups (avoids repeated queries)
export async function getDispositionsMapAsync(): Promise<Map<string, Disposition>> {
  const dispositions = await getDispositionsAsync();
  return new Map(dispositions.map(d => [d.id, d]));
}
