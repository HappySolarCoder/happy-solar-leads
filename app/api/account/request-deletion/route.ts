import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { handleRequestAccountDeletion } from '@/app/utils/server/requestAccountDeletion';

function methodNotAllowed() {
  return NextResponse.json(
    { ok: false, error: 'method-not-allowed' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const OPTIONS = methodNotAllowed;

export async function POST(request: NextRequest) {
  try {
    const result = await handleRequestAccountDeletion({
      authorization: request.headers.get('authorization'),
      deps: {
        verifyIdToken: (token, checkRevoked) => adminAuth().verifyIdToken(token, checkRevoked),
        auth: {
          updateUser: (uid, properties) => adminAuth().updateUser(uid, properties),
          revokeRefreshTokens: (uid) => adminAuth().revokeRefreshTokens(uid),
        },
        db: adminDb(),
        serverTimestamp: () => FieldValue.serverTimestamp(),
        log: (line) => {
          console.log(line);
        },
      },
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('[api/account/request-deletion] error:', error);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}
