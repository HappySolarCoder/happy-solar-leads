import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { requiresRoleApproval } from '@/app/types';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 401 });
    }

    const idToken = authHeader.split(' ')[1];
    const decoded = await adminAuth().verifyIdToken(idToken);
    const body = await request.json();

    const name = String(body?.name || '').trim();
    const email = String(body?.email || '').trim();
    const requestedRole = String(body?.requestedRole || 'setter').trim();

    if (!name || !email) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
    }

    const allowedRoles = new Set(['setter', 'closer', 'manager', 'admin']);
    const normalizedRequestedRole = allowedRoles.has(requestedRole) ? requestedRole : 'setter';
    const needsApproval = requiresRoleApproval(normalizedRequestedRole as any);
    const assignedRole = needsApproval ? 'setter' : normalizedRequestedRole;
    const now = new Date();

    await adminDb().collection('users').doc(decoded.uid).set({
      id: decoded.uid,
      name,
      email,
      role: assignedRole,
      requestedRole: normalizedRequestedRole,
      approved: !needsApproval,
      approvalStatus: needsApproval ? 'pending' : 'approved',
      approvalRequestedAt: needsApproval ? now : null,
      createdAt: now,
      status: needsApproval ? 'Pending Approval' : 'active',
      isActive: !needsApproval,
      color: `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`,
    }, { merge: true });

    return NextResponse.json({ success: true, needsApproval, assignedRole });
  } catch (error: any) {
    console.error('[api/auth/create-profile] error:', error);
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 });
  }
}
