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
    
    // Get dispositions
    const dispSnapshot = await getDocs(query(collection(db, 'dispositions'), orderBy('order', 'asc')));
    const dispositions = dispSnapshot.docs.map(doc => {
      const data = doc.data() as any;
      return {
        id: doc.id,
        name: data.name,
        countsAsDoorKnock: data.countsAsDoorKnock,
      };
    });
    
    // Get unique lead statuses
    const leadsSnapshot = await getDocs(query(collection(db, 'leads')));
    const statuses = new Set<string>();
    leadsSnapshot.docs.forEach(doc => {
      const data = doc.data() as any;
      if (data.status) statuses.add(data.status);
    });
    
    return NextResponse.json({ 
      dispositions,
      leadStatuses: Array.from(statuses),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
