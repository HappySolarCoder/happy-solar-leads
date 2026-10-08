import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { clearMustChangePassword } from '@/app/utils/passwordChange';
import { readBearerToken } from '@/app/utils/provisionUser';

export const runtime = 'nodejs';

/**
 * Called by /change-password after the signed-in user updates their password.
 * Uses the Admin SDK so it does not depend on a Firestore rules deploy.
 */
export async function POST(request: NextRequest) {
  try {
    const result = await clearMustChangePassword({
      idToken: readBearerToken(request.headers.get('authorization')),
      verifyIdToken: (token) => adminAuth().verifyIdToken(token),
      readFlag: async (uid) => {
        const snap = await adminDb().collection('users').doc(uid).get();
        if (!snap.exists) return null;
        return snap.get('mustChangePassword') === true;
      },
      clearFlag: async (uid) => {
        await adminDb().collection('users').doc(uid).update({ mustChangePassword: false });
      },
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch {
    console.error('[api/auth/password-changed] failed');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
