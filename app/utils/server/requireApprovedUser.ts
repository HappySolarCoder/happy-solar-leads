import { NextRequest } from 'next/server';
import { isDeletionRequestedStatus } from '../accountDeletion';
import { adminAuth, adminDb } from '../firebase-admin';

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export type UserProfile = Record<string, unknown>;

export type ApprovedUser = {
  uid: string;
  user: UserProfile;
  role: string;
};

export type VerifiedToken = {
  uid: string;
  email?: string;
};

export type RequireApprovedUserDeps = {
  verifyIdToken: (token: string, checkRevoked: true) => Promise<VerifiedToken>;
  getUser: (uid: string) => Promise<{ exists: boolean; data?: UserProfile }>;
};

export function bearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
  return match ? match[1] : null;
}

export function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return String((error as { code?: unknown }).code || '').startsWith('auth/');
}

/**
 * Same deny-list as mobile lead reads, plus status `deletion-requested`.
 * Missing flags are allowed so legacy user docs that predate approval fields keep working.
 */
export function isDeniedAccount(exists: boolean, user: UserProfile | undefined): boolean {
  if (!exists || !user) return true;
  return Boolean(
    user.deleted ||
      user.deletionPending ||
      user.isActive === false ||
      user.approved === false ||
      user.approvalStatus === 'pending' ||
      isDeletionRequestedStatus(user.status),
  );
}

export async function requireApprovedUser(
  authorization: string | null | undefined,
  deps: RequireApprovedUserDeps,
): Promise<ApprovedUser> {
  const token = bearerToken(authorization);
  if (!token) throw new HttpError(401, 'Missing credentials');

  let decoded: VerifiedToken;
  try {
    decoded = await deps.verifyIdToken(token, true);
  } catch (error) {
    if (isAuthError(error)) throw new HttpError(401, 'Sign in again.');
    throw error;
  }

  if (!decoded?.uid) throw new HttpError(401, 'Sign in again.');

  const snap = await deps.getUser(decoded.uid);
  if (isDeniedAccount(snap.exists, snap.data)) {
    throw new HttpError(403, 'This account is not approved.');
  }

  const user = snap.data as UserProfile;
  const role = typeof user.role === 'string' ? user.role : '';
  return { uid: decoded.uid, user, role };
}

export async function requireApprovedRequestUser(request: NextRequest): Promise<ApprovedUser> {
  return requireApprovedUser(request.headers.get('authorization'), {
    verifyIdToken: (token, checkRevoked) => adminAuth().verifyIdToken(token, checkRevoked),
    getUser: async (uid) => {
      const doc = await adminDb().collection('users').doc(uid).get();
      return { exists: doc.exists, data: doc.data() };
    },
  });
}
