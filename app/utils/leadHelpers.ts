// Lead Update Helpers with Disposition History Tracking
import { doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import { recordDispositionChange } from './dispositionHistory';
import { Lead } from '@/app/types';

/**
 * Update lead disposition with automatic history tracking
 * Use this instead of direct updateDoc for disposition changes
 */
export async function updateLeadDisposition(
  leadId: string,
  leadAddress: string,
  previousDisposition: string | undefined,
  newDisposition: string,
  userId: string,
  userName: string,
  userRole: string,
  additionalUpdates?: Partial<Lead>,
  options?: {
    knockGpsLat?: number;
    knockGpsLng?: number;
    knockGpsAccuracy?: number;
    knockDistanceFromAddress?: number;
    objectionType?: string;
    objectionNotes?: string;
    notes?: string;
    source?: 'manual' | 'auto-assignment' | 'claim' | 'admin-action';
  }
): Promise<void> {
  if (!db) {
    throw new Error('Firestore not initialized');
  }

  // Update the lead document
  const leadRef = doc(db, 'leads', leadId);
  const updates: any = {
    status: newDisposition,
    disposition: newDisposition,
    dispositionedAt: Timestamp.now(),
    ...additionalUpdates,
  };

  await updateDoc(leadRef, updates);

  // Record in disposition history
  await recordDispositionChange(
    leadId,
    leadAddress,
    previousDisposition,
    newDisposition,
    userId,
    userName,
    userRole,
    options
  );
}

/**
 * Claim a lead with automatic history tracking
 */
export async function claimLead(
  leadId: string,
  leadAddress: string,
  userId: string,
  userName: string,
  userRole: string
): Promise<void> {
  if (!db) {
    throw new Error('Firestore not initialized');
  }

  const now = Timestamp.now();
  const leadRef = doc(db, 'leads', leadId);
  
  await updateDoc(leadRef, {
    claimedBy: userId,
    claimedAt: now,
    status: 'claimed',
  });

  // Record in history
  await recordDispositionChange(
    leadId,
    leadAddress,
    'unclaimed',
    'claimed',
    userId,
    userName,
    userRole,
    {
      source: 'claim',
      notes: 'Lead claimed by user',
    }
  );
}

/**
 * Unclaim a lead with automatic history tracking
 */
export async function unclaimLead(
  leadId: string,
  leadAddress: string,
  previousStatus: string,
  userId: string,
  userName: string,
  userRole: string,
  reason?: string
): Promise<void> {
  if (!db) {
    throw new Error('Firestore not initialized');
  }

  const now = Timestamp.now();
  const leadRef = doc(db, 'leads', leadId);
  
  await updateDoc(leadRef, {
    claimedBy: null,
    claimedAt: null,
    assignedTo: null,
    assignedAt: null,
    status: 'unclaimed',
    unclaimedAt: now,
  });

  // Record in history
  await recordDispositionChange(
    leadId,
    leadAddress,
    previousStatus,
    'unclaimed',
    userId,
    userName,
    userRole,
    {
      source: 'manual',
      notes: reason || 'Lead unclaimed by user',
    }
  );
}
