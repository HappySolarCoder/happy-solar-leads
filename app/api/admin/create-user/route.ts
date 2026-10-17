import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { handleCreateAdminUser, type CreateAdminUserDeps } from '@/app/utils/server/createAdminUser';

export const runtime = 'nodejs';

function liveDeps(): CreateAdminUserDeps {
  return {
    verifyIdToken: (token, checkRevoked) => adminAuth().verifyIdToken(token, checkRevoked),
    getUser: async (uid) => {
      const doc = await adminDb().collection('users').doc(uid).get();
      return { exists: doc.exists, data: doc.data() };
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const result = await handleCreateAdminUser({
    authorization: request.headers.get('authorization'),
    body,
    deps: liveDeps(),
    logger: (message) => {
      console.error(message);
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}
