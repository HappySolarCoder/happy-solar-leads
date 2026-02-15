// Firebase Configuration and Initialization
import { initializeApp, getApps, getApp, FirebaseApp, deleteApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Only initialize on client-side
let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

if (typeof window !== 'undefined' && firebaseConfig.apiKey) {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  db = getFirestore(app);
  auth = getAuth(app);
}

// Helper to create secondary app for privileged actions (e.g., admin creating users)
export async function createSecondaryAuth() {
  if (typeof window === 'undefined' || !firebaseConfig.apiKey) return null;
  const name = `secondary-${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, name);
  const secondaryAuth = getAuth(secondaryApp);
  return {
    auth: secondaryAuth,
    dispose: async () => {
      try {
        await deleteApp(secondaryApp);
      } catch (error) {
        console.warn('Error disposing secondary Firebase app:', error);
      }
    },
  };
}

export { db, auth, firebaseConfig, app as default };
