import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import { initializeApp, getApps } from 'firebase/app';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function getDb() {
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  return getFirestore(app);
}

export interface UserSession {
  // Map state
  mapCenter?: { lat: number; lng: number };
  mapZoom?: number;
  mapType?: 'street' | 'satellite';
  
  // Filter state
  setterFilter?: string;
  solarFilter?: 'all' | 'solid' | 'good' | 'great';
  dispositionFilter?: string;
  
  // View state
  viewMode?: 'split' | 'map' | 'list';
  sidebarOpen?: boolean;
  
  // Last activity
  lastActiveAt: number;
}

/**
 * Save user session state to Firestore
 */
export async function saveUserSession(userId: string, session: Partial<UserSession>): Promise<void> {
  try {
    const db = getDb();
    const sessionRef = doc(db, 'userSessions', userId);
    await setDoc(sessionRef, {
      ...session,
      lastActiveAt: Date.now(),
    }, { merge: true });
    console.log('[UserSession] Saved:', session);
  } catch (error) {
    console.error('[UserSession] Error saving:', error);
  }
}

/**
 * Load user session state from Firestore
 */
export async function loadUserSession(userId: string): Promise<UserSession | null> {
  try {
    const db = getDb();
    const sessionRef = doc(db, 'userSessions', userId);
    const snapshot = await getDoc(sessionRef);
    
    if (snapshot.exists()) {
      const data = snapshot.data() as UserSession;
      console.log('[UserSession] Loaded:', data);
      return data;
    }
    
    console.log('[UserSession] No session found');
    return null;
  } catch (error) {
    console.error('[UserSession] Error loading:', error);
    return null;
  }
}

/**
 * Get default session for new users
 */
export function getDefaultSession(): UserSession {
  return {
    mapCenter: { lat: 43.1566, lng: -77.6088 }, // Rochester, NY
    mapZoom: 11,
    mapType: 'satellite',
    setterFilter: 'all',
    solarFilter: 'all',
    dispositionFilter: 'all',
    viewMode: 'split',
    sidebarOpen: true,
    lastActiveAt: Date.now(),
  };
}
