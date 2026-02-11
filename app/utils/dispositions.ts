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
    if (typeof window === 'undefined') {
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
    await setDoc(doc(db, DISPOSITIONS_COLLECTION, disposition.id), {
      ...disposition,
      updatedAt: new Date(),
    });
  } catch (error) {
    console.error('Error saving disposition:', error);
    throw error;
  }
}

// Delete disposition (only if not default)
export async function deleteDispositionAsync(id: string): Promise<void> {
  try {
    const dispositions = await getDispositionsAsync();
    const disposition = dispositions.find(d => d.id === id);
    
    if (disposition?.isDefault) {
      throw new Error('Cannot delete default disposition');
    }
    
    await deleteDoc(doc(db, DISPOSITIONS_COLLECTION, id));
  } catch (error) {
    console.error('Error deleting disposition:', error);
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
