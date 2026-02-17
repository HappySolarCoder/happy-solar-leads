import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

/**
 * Admin API: Unassign leads from a user
 * Makes leads available again while preserving disposition history
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 401 });
    }

    const idToken = authHeader.split(' ')[1];
    const decoded = await adminAuth().verifyIdToken(idToken);

    const adminDoc = await adminDb().collection('users').doc(decoded.uid).get();
    const adminData = adminDoc.data();
    if (!adminDoc.exists || adminData?.role !== 'admin') {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const body = await request.json();
    const { userId, leadIds } = body;

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    // Get user info for history tracking
    const userDoc = await adminDb().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const userData = userDoc.data();

    let query = adminDb().collection('leads').where('claimedBy', '==', userId);
    
    // If specific leadIds provided, filter to those
    if (leadIds && Array.isArray(leadIds) && leadIds.length > 0) {
      query = adminDb().collection('leads').where('__name__', 'in', leadIds);
    }

    const snapshot = await query.get();
    
    if (snapshot.empty) {
      return NextResponse.json({ 
        success: true, 
        message: 'No leads to unassign',
        unassignedCount: 0 
      });
    }

    const batch = adminDb().batch();
    const now = Timestamp.now();
    let unassignedCount = 0;

    // Unassign each lead
    for (const doc of snapshot.docs) {
      const leadData = doc.data();
      
      // Only unassign if actually assigned to this user
      if (leadData.claimedBy === userId || leadData.assignedTo === userId) {
        batch.update(doc.ref, {
          claimedBy: FieldValue.delete(),
          claimedAt: FieldValue.delete(),
          assignedTo: FieldValue.delete(),
          assignedAt: FieldValue.delete(),
          autoAssigned: FieldValue.delete(),
          lastAssignedTo: userId, // Track previous owner
          status: 'unclaimed', // Make available again
          unassignedAt: now,
          unassignedBy: decoded.uid,
        });

        // Record in disposition history
        const historyEntry = {
          leadId: doc.id,
          leadAddress: leadData.address || 'Unknown',
          previousDisposition: leadData.status || 'claimed',
          newDisposition: 'unclaimed',
          userId: decoded.uid, // Admin who unassigned
          userName: adminData?.name || 'Admin',
          userRole: 'admin',
          createdAt: now,
          notes: `Unassigned from ${userData?.name || 'user'} (${userId})`,
          source: 'admin-action',
        };
        
        const historyRef = adminDb().collection('disposition_history').doc();
        batch.set(historyRef, historyEntry);

        unassignedCount++;
      }
    }

    await batch.commit();

    return NextResponse.json({ 
      success: true,
      unassignedCount,
      message: `Successfully unassigned ${unassignedCount} lead(s) from ${userData?.name || 'user'}`
    });

  } catch (error: any) {
    console.error('[Admin Unassign Leads] error:', error);
    const message = error?.message || 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
