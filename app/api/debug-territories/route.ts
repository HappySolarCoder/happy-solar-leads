import { NextResponse } from 'next/server';
import { getFirestore, collection, getDocs, query, orderBy } from 'firebase/firestore';
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

export async function GET() {
  try {
    const db = getDb();
    const snapshot = await getDocs(query(collection(db, 'territories'), orderBy('createdAt', 'desc')));
    
    if (snapshot.empty) {
      return NextResponse.json({ error: 'No territories found', territories: [] });
    }
    
    const territories = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      // Don't return polygon to keep response small
      polygonPointCount: doc.data().polygon?.length || 0,
    }));
    
    return NextResponse.json({ territories });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
