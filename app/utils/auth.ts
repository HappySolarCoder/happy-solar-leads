// Firebase Authentication utilities
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { User } from '@/app/types';

// Get currently authenticated user from Firestore
export async function getCurrentAuthUser(): Promise<User | null> {
  if (!auth || !db) {
    console.warn('Firebase not initialized');
    return null;
  }

  return new Promise((resolve) => {
    if (!auth) {
      resolve(null);
      return;
    }
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      unsubscribe();
      
      if (!firebaseUser || !db) {
        resolve(null);
        return;
      }

      try {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        
        if (userDoc.exists()) {
          const data = userDoc.data();
          resolve({
            ...data,
            id: firebaseUser.uid,
            createdAt: data.createdAt?.toDate?.() || new Date(),
            lastLogin: data.lastLogin?.toDate?.() || undefined,
          } as User);
        } else {
          resolve(null);
        }
      } catch (error) {
        console.error('Error fetching user from Firestore:', error);
        resolve(null);
      }
    });
  });
}

// Check if user is authenticated
export function isAuthenticated(): Promise<boolean> {
  if (!auth) return Promise.resolve(false);
  
  return new Promise((resolve) => {
    if (!auth) {
      resolve(false);
      return;
    }
    
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(!!user);
    });
  });
}

// Sign out
export async function signOut(): Promise<void> {
  if (!auth) return;
  
  await firebaseSignOut(auth);
  
  // Clear localStorage
  if (typeof window !== 'undefined') {
    localStorage.removeItem('raydar_current_user_id');
  }
}

// Listen to auth state changes
export function onAuthChange(callback: (user: User | null) => void): () => void {
  if (!auth || !db) {
    return () => {};
  }

  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser || !db) {
      callback(null);
      return;
    }

    try {
      const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
      
      if (userDoc.exists()) {
        const data = userDoc.data();
        callback({
          ...data,
          id: firebaseUser.uid,
          createdAt: data.createdAt?.toDate?.() || new Date(),
          lastLogin: data.lastLogin?.toDate?.() || undefined,
        } as User);
      } else {
        callback(null);
      }
    } catch (error) {
      console.error('Error in auth state change:', error);
      callback(null);
    }
  });
}
