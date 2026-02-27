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
    
    // Get territories
    const territoriesSnapshot = await getDocs(query(collection(db, 'territories'), orderBy('createdAt', 'desc')));
    const territories = territoriesSnapshot.docs.map(doc => {
      const data = doc.data() as any;
      return {
        id: doc.id,
        ...data,
      };
    });
    
    // Get a sample of leads to test - get older ones too
    const allLeadsSnapshot = await getDocs(query(collection(db, 'leads'), orderBy('createdAt', 'desc')));
    const allLeads = allLeadsSnapshot.docs.map(doc => {
      const data = doc.data() as any;
      return {
        id: doc.id,
        ...data,
      };
    });
    
    // Get first 100 and also some with dispositions
    const leads = allLeads.slice(0, 100);
    const withDisposition = allLeads.filter(l => l.dispositionedAt).slice(0, 50);
    const combined = [...leads];
    for (const l of withDisposition) {
      if (!combined.find(c => c.id === l.id)) {
        combined.push(l);
        if (combined.length >= 150) break;
      }
    }
    
    return NextResponse.json({ 
      totalLeads: allLeads.length,
      withDisposition: allLeads.filter(l => l.dispositionedAt).length,
      territories: territories.map(t => ({
        id: t.id,
        userName: t.userName,
        userId: t.userId,
        polygonPoints: t.polygon?.length || 0,
      })),
      sampleLeads: combined.map(l => ({
        id: l.id,
        lat: l.lat,
        lng: l.lng,
        address: l.address,
        status: l.status,
        assignedTo: l.assignedTo,
        claimedBy: l.claimedBy,
        dispositionedAt: l.dispositionedAt,
      }))
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
