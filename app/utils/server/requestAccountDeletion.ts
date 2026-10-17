import {
  ADMIN_SELF_DELETE_ERROR,
  DELETION_REQUESTED_STATUS,
  isDeletionRequestedStatus,
} from '../accountDeletion';
import { bearerToken, isAuthError, type VerifiedToken } from './requireApprovedUser';

export type UserRecord = Record<string, unknown>;

export type AccountDoc = {
  get: () => Promise<{ exists: boolean; data: () => UserRecord | undefined }>;
  set: (data: UserRecord, options: { merge: true }) => Promise<unknown>;
};

export type AccountDb = {
  collection: (name: string) => {
    doc: (id: string) => AccountDoc;
  };
};

export type RequestAccountDeletionDeps = {
  verifyIdToken: (token: string, checkRevoked: true) => Promise<VerifiedToken>;
  auth: {
    updateUser: (uid: string, properties: { disabled: true }) => Promise<unknown>;
    revokeRefreshTokens: (uid: string) => Promise<unknown>;
  };
  db: AccountDb;
  serverTimestamp: () => unknown;
  log: (line: string) => void;
};

export type RequestAccountDeletionResult = {
  status: number;
  body: { ok: boolean; disabled?: boolean; error?: string };
};

const USERS = 'users';

function roleForLog(role: string): string {
  return role.replace(/[\r\n]/g, '');
}

function deletionLogLine(uid: string, role: string): string {
  return `[account-deletion-requested] uid=${uid} role=${role}`;
}

/**
 * POST /api/account/request-deletion.
 * Touches Auth and users/{uid} only. No lead, visit, knock, disposition,
 * territory, or history reads or writes, and no collection scans.
 */
export async function handleRequestAccountDeletion(input: {
  authorization: string | null;
  deps: RequestAccountDeletionDeps;
}): Promise<RequestAccountDeletionResult> {
  const token = bearerToken(input.authorization);
  if (!token) return { status: 401, body: { ok: false, error: 'Missing credentials' } };

  let decoded: VerifiedToken;
  try {
    decoded = await input.deps.verifyIdToken(token, true);
  } catch (error) {
    if (isAuthError(error)) return { status: 401, body: { ok: false, error: 'Sign in again.' } };
    throw error;
  }

  if (!decoded?.uid) return { status: 401, body: { ok: false, error: 'Sign in again.' } };

  const uid = decoded.uid;
  const snap = await input.deps.db.collection(USERS).doc(uid).get();
  const profile = snap.exists ? snap.data() : undefined;
  const role = typeof profile?.role === 'string' ? profile.role : '';

  if (role === 'admin') {
    return { status: 403, body: { ok: false, error: ADMIN_SELF_DELETE_ERROR } };
  }

  await input.deps.auth.updateUser(uid, { disabled: true });

  if (!isDeletionRequestedStatus(profile?.status)) {
    await input.deps.auth.revokeRefreshTokens(uid);
    await input.deps.db.collection(USERS).doc(uid).set(
      {
        isActive: false,
        status: DELETION_REQUESTED_STATUS,
        deletionRequestedAt: input.deps.serverTimestamp(),
      },
      { merge: true },
    );
  }

  input.deps.log(deletionLogLine(uid, roleForLog(role)));
  return { status: 200, body: { ok: true, disabled: true } };
}
