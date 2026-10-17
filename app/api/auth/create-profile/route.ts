import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import {
  handleCreateProfile,
  isAlreadyExistsError,
  ProfileExistsError,
} from '@/app/utils/server/createProfile';

export async function POST(request: NextRequest) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    const result = await handleCreateProfile({
      authorization: request.headers.get('authorization'),
      body,
      signupEnabled: process.env.SELF_SIGNUP_ENABLED === 'true',
      deps: {
        verifyIdToken: (token, checkRevoked) => adminAuth().verifyIdToken(token, checkRevoked),
        createUserDoc: async (uid, data) => {
          try {
            await adminDb().collection('users').doc(uid).create(data);
          } catch (error) {
            if (isAlreadyExistsError(error)) throw new ProfileExistsError();
            throw error;
          }
        },
      },
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('[api/auth/create-profile] error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
