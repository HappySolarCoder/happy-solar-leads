import { NextResponse } from 'next/server';
import { getFirestore, collection, getDocs, query, limit } from 'firebase/firestore';
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
    
    // Get ALL leads (no limit) to count total
    const allLeadsSnapshot = await getDocs(query(collection(db, 'leads'), limit(5000)));
    const allLeads = allLeadsSnapshot.docs.map(doc => doc.data());
    
    // Count statuses
    const statusCounts: Record<string, number> = {};
    allLeads.forEach(lead => {
      const status = lead.status || 'undefined';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    
    // Get a sample with status
    const sample = allLeadsSnapshot.docs.slice(0, 30).map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        status: d.status,
        claimedBy: d.claimedBy,
        assignedTo: d.assignedTo,
        dispositionedAt: d.dispositionedAt,
        address: d.address,
      };
    });
    
    return NextResponse.json({ 
      totalLeads: allLeads.length,
      statusCounts,
      sample,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
