import { NextResponse } from 'next/server';
import { getFirestore, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
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
    
    // Get leads that ARE assigned
    const assignedSnapshot = await getDocs(query(
      collection(db, 'leads'),
      orderBy('assignedAt', 'desc'),
      limit(10)
    ));
    
    const assignedLeads = assignedSnapshot.docs.map(doc => {
      const data = doc.data() as any;
      return {
        id: doc.id,
        lat: data.lat,
        lng: data.lng,
        address: data.address,
        assignedTo: data.assignedTo,
        assignedAt: data.assignedAt,
      };
    });
    
    return NextResponse.json({ assignedLeads });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
