import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { handleProvisionPost, isProvisionAuthorized, type ProvisionDeps } from '@/app/utils/provisionUser';

export const runtime = 'nodejs';

function authErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code || '');
  }
  return '';
}

function liveDeps(): ProvisionDeps {
  return {
    async getUserByEmail(email) {
      try {
        const user = await adminAuth().getUserByEmail(email);
        return { uid: user.uid };
      } catch (error) {
        if (authErrorCode(error) === 'auth/user-not-found') return null;
        throw error;
      }
    },
    async getProfileExists(uid) {
      const snap = await adminDb().collection('users').doc(uid).get();
      return snap.exists;
    },
    async createUser(input) {
      const user = await adminAuth().createUser({
        email: input.email,
        password: input.password,
        displayName: input.displayName,
      });
      return { uid: user.uid };
    },
    async setUserDoc(uid, data) {
      await adminDb().collection('users').doc(uid).set(data);
    },
    async deleteUser(uid) {
      await adminAuth().deleteUser(uid);
    },
  };
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  const secret = process.env.RAYDAR_PROVISION_SECRET?.trim();

  if (!isProvisionAuthorized(authorization, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const result = await handleProvisionPost({
    authorization,
    secret,
    body,
    deps: liveDeps(),
    logger: (message) => {
      console.error(message);
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}
