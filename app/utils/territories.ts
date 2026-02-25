import { collection, addDoc, getDocs, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { db } from './firebase';
import { Territory } from '@/app/types/territory';

export async function saveTerritory(territory: Omit<Territory, 'id'>): Promise<string> {
  if (!db) throw new Error('Firestore not initialized');
  
  const territoriesRef = collection(db, 'territories');
  const docRef = await addDoc(territoriesRef, {
    ...territory,
    createdAt: territory.createdAt.toISOString(),
  });
  
  return docRef.id;
}

export async function getTerritoriesAsync(): Promise<Territory[]> {
  if (!db) return [];
  
  try {
    const territoriesRef = collection(db, 'territories');
    const q = query(territoriesRef, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: new Date(doc.data().createdAt),
    })) as Territory[];
  } catch (error) {
    console.error('Error loading territories:', error);
    return [];
  }
}

export async function deleteTerritory(id: string): Promise<void> {
  if (!db) throw new Error('Firestore not initialized');
  
  const territoryRef = doc(db, 'territories', id);
  await deleteDoc(territoryRef);
}
