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
    
    // Get disposition history
    const historySnapshot = await getDocs(query(collection(db, 'disposition_history'), orderBy('timestamp', 'desc'), limit(20)));
    const history = historySnapshot.docs.map(doc => {
      const data = doc.data() as any;
      return {
        id: doc.id,
        leadId: data.leadId,
        status: data.status,
        userId: data.userId,
        timestamp: data.timestamp?.toDate?.() || data.timestamp,
      };
    });
    
    // Get leads with dispositions
    const leadsSnapshot = await getDocs(query(collection(db, 'leads'), orderBy('dispositionedAt', 'desc'), limit(30)));
    const leads = leadsSnapshot.docs.map(doc => {
      const data = doc.data() as any;
      return {
        id: doc.id,
        status: data.status,
        dispositionedAt: data.dispositionedAt?.toDate?.() || data.dispositionedAt,
        claimedBy: data.claimedBy,
        address: data.address,
      };
    }).filter(l => l.status && ['not-home', 'interested', 'not-interested', 'appointment', 'sale'].includes(l.status));
    
    return NextResponse.json({ 
      dispositionHistory: history,
      leadsWithDispositions: leads,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
