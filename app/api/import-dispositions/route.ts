import { NextResponse } from 'next/server';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import { initializeApp, getApps } from 'firebase/app';
import Papa from 'papaparse';

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

// Map disposition names to status values
const DISPOSITION_MAP: Record<string, string> = {
  'Not Home': 'not-home',
  'Not Interested': 'not-interested',
  'Interested': 'interested',
  'Appointment Set': 'appointment',
  'Appointment': 'appointment',
  'Sale!': 'sale',
  'DQ Credit': 'dq-credit',
  'Shade DQ': 'shade-dq',
  'Callback Scheduled': 'follow-up-later',
  'Go Back': 'go-back',
  'Renter': 'renter',
  // Also handle lowercase versions
  'not home': 'not-home',
  'not interested': 'not-interested',
  'callback scheduled': 'follow-up-later',
  'go back': 'go-back',
  'dq credit': 'dq-credit',
  'shade dq': 'shade-dq',
};

function parseFirestoreTimestamp(ts: any): any {
  if (!ts) return null;
  if (ts.__time__) {
    // Firestore timestamp format: { __time__: "2026-02-25T14:08:54.574Z" }
    return new Date(ts.__time__);
  }
  if (typeof ts === 'string') return new Date(ts);
  return ts;
}

export async function POST(request: Request) {
  try {
    const db = getDb();
    const body = await request.text();
    
    // Parse CSV
    const { data } = Papa.parse(body, { header: true, skipEmptyLines: true });
    
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const row of data as any[]) {
      try {
        const leadId = row.__id__;
        if (!leadId) {
          skipped++;
          continue;
        }
        
        // Parse disposition history
        let dispositionHistory: any[] = [];
        if (row.dispositionHistory) {
          try {
            dispositionHistory = JSON.parse(row.dispositionHistory);
          } catch (e) {
            console.log('Failed to parse disposition history for', leadId);
          }
        }
        
        // Get the most recent disposition from history
        const latestDisposition = dispositionHistory[dispositionHistory.length - 1];
        
        // Map disposition name to status
        let status = 'unclaimed';
        if (latestDisposition?.disposition) {
          status = DISPOSITION_MAP[latestDisposition.disposition] || latestDisposition.disposition.toLowerCase().replace(/ /g, '-');
        }
        
        // Parse dispositionedAt
        let dispositionedAt = null;
        if (row.dispositionedAt) {
          dispositionedAt = new Date(row.dispositionedAt);
        } else if (latestDisposition?.timestamp) {
          const ts = parseFirestoreTimestamp(latestDisposition.timestamp);
          if (ts) dispositionedAt = ts;
        }
        
        // Get claimedBy from disposition history (last user who dispositioned)
        let claimedBy = row.claimedBy || null;
        if (!claimedBy && latestDisposition?.userId) {
          claimedBy = latestDisposition.userId;
        }
        
        // Update the lead document
        const leadRef = doc(db, 'leads', leadId);
        
        await setDoc(leadRef, {
          status,
          dispositionedAt,
          dispositionHistory,
          claimedBy,
          claimedAt: dispositionedAt,
        }, { merge: true });
        
        updated++;
        
      } catch (rowError: any) {
        console.error('Error processing row:', rowError.message);
        errors++;
      }
    }
    
    return NextResponse.json({ 
      success: true,
      updated,
      skipped,
      errors,
    });
    
  } catch (error: any) {
    console.error('Import error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
