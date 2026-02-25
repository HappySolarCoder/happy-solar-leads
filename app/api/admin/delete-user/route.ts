import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

/**
 * Admin API: Delete user account (soft or hard delete)
 * 
 * Soft delete: Marks user as deleted, preserves data
 * Hard delete: Completely removes user, unclaims leads, preserves disposition history
 */
export async function POST(request: NextRequest) {
  try {
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
    const { userId, deleteType = 'soft' } = body;
    
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    if (!['soft', 'hard'].includes(deleteType)) {
      return NextResponse.json({ error: 'Invalid deleteType (must be "soft" or "hard")' }, { status: 400 });
    }

    // Get user info before deletion
    const userDoc = await adminDb().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const userData = userDoc.data();
    const userName = userData?.name || 'Unknown User';

    // Prevent self-deletion
    if (userId === decoded.uid) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
    }

    const now = Timestamp.now();
    let result: any = { success: true, deleteType };

    if (deleteType === 'soft') {
      // SOFT DELETE: Mark as deleted, preserve data
      await adminDb().collection('users').doc(userId).update({
        deleted: true,
        deletedAt: now,
        deletedBy: decoded.uid,
        isActive: false, // Prevent auto-assignment
      });

      // Disable Firebase Auth account (they can't log in)
      try {
        await adminAuth().updateUser(userId, { disabled: true });
      } catch (authError) {
        console.warn('Could not disable auth account (may already be deleted):', authError);
      }

      result.message = `User "${userName}" soft deleted (marked inactive, can be restored)`;
      
    } else {
      // HARD DELETE: Complete removal with cleanup
      
      // Step 1: Unclaim all leads assigned to this user
      const leadsSnapshot = await adminDb()
        .collection('leads')
        .where('claimedBy', '==', userId)
        .get();

      const batch = adminDb().batch();
      let unclaimedCount = 0;

      for (const doc of leadsSnapshot.docs) {
        const leadData = doc.data();
        
        batch.update(doc.ref, {
          claimedBy: FieldValue.delete(),
          claimedAt: FieldValue.delete(),
          assignedTo: FieldValue.delete(),
          assignedAt: FieldValue.delete(),
          autoAssigned: FieldValue.delete(),
          lastAssignedTo: userId, // Track previous owner
          status: 'unclaimed', // Make available again
          unclaimedAt: now,
          unclaimedBy: decoded.uid,
          unclaimReason: 'user-deleted',
        });

        // Record in disposition history (preserving the fact that this user worked this lead)
        const historyEntry = {
          leadId: doc.id,
          leadAddress: leadData.address || 'Unknown',
          previousDisposition: leadData.status || 'claimed',
          newDisposition: 'unclaimed',
          userId: decoded.uid, // Admin who deleted the user
          userName: adminData?.name || 'Admin',
          userRole: 'admin',
          createdAt: now,
          notes: `Unclaimed due to user deletion: ${userName} (${userId})`,
          source: 'admin-action',
          originalUserId: userId, // Track who originally had it
          originalUserName: userName,
        };
        
        const historyRef = adminDb().collection('disposition_history').doc();
        batch.set(historyRef, historyEntry);

        unclaimedCount++;
      }

      await batch.commit();

      // Step 1.5: Delete all territories owned by this user
      const territoriesSnapshot = await adminDb()
        .collection('territories')
        .where('userId', '==', userId)
        .get();

      let deletedTerritoriesCount = 0;
      if (!territoriesSnapshot.empty) {
        const territoryBatch = adminDb().batch();
        
        for (const doc of territoriesSnapshot.docs) {
          territoryBatch.delete(doc.ref);
          deletedTerritoriesCount++;
        }
        
        await territoryBatch.commit();
      }

      // Step 2: Also unclaim leads where user is assignedTo but not claimedBy
      const assignedSnapshot = await adminDb()
        .collection('leads')
        .where('assignedTo', '==', userId)
        .get();

      if (!assignedSnapshot.empty) {
        const batch2 = adminDb().batch();
        let hasUpdates = false;
        
        for (const doc of assignedSnapshot.docs) {
          const leadData = doc.data();
          
          // Only process if not already handled above
          if (leadData.claimedBy !== userId) {
            batch2.update(doc.ref, {
              assignedTo: FieldValue.delete(),
              assignedAt: FieldValue.delete(),
              autoAssigned: FieldValue.delete(),
              lastAssignedTo: userId,
            });
            unclaimedCount++;
            hasUpdates = true;
          }
        }
        
        if (hasUpdates) {
          await batch2.commit();
        }
      }

      // Step 3: Delete from Firebase Auth
      try {
        await adminAuth().deleteUser(userId);
      } catch (authError: any) {
        console.warn('Could not delete auth user (may already be deleted):', authError?.message);
      }

      // Step 4: Delete user document from Firestore
      await adminDb().collection('users').doc(userId).delete();

      result.message = `User "${userName}" permanently deleted`;
      result.unclaimedLeadsCount = unclaimedCount;
      result.deletedTerritoriesCount = deletedTerritoriesCount;
      result.note = 'Disposition history preserved for auditing. Territories deleted.';
    }

    return NextResponse.json(result);

  } catch (error: any) {
    console.error('[Admin Delete User] error:', error);
    const message = error?.message || 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
