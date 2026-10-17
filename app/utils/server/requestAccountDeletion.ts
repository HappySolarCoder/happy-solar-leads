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
  verifyIdToken: (token: string, checkRevoked?: boolean) => Promise<VerifiedToken>;
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

function authErrorCode(error: unknown): string {
  if (!isAuthError(error) || !error || typeof error !== 'object') return '';
  return String((error as { code?: unknown }).code || '');
}

/** Tokens that fail checkRevoked only because this route already disabled the user. */
function isDisabledOrRevokedAuthError(error: unknown): boolean {
  const code = authErrorCode(error);
  return code === 'auth/user-disabled' || code === 'auth/id-token-revoked';
}

function signInAgain(): RequestAccountDeletionResult {
  return { status: 401, body: { ok: false, error: 'Sign in again.' } };
}

function roleOf(profile: UserRecord | undefined): string {
  return typeof profile?.role === 'string' ? profile.role : '';
}

async function readProfile(deps: RequestAccountDeletionDeps, uid: string): Promise<UserRecord | undefined> {
  const snap = await deps.db.collection(USERS).doc(uid).get();
  return snap.exists ? snap.data() : undefined;
}

async function ensureAuthDisabled(deps: RequestAccountDeletionDeps, uid: string): Promise<void> {
  await deps.auth.updateUser(uid, { disabled: true });
}

/**
 * Repeat call after the first request disabled Auth and revoked refresh tokens.
 * verifyIdToken(token, true) rejects those tokens; verify again without the
 * revocation check and succeed only when the profile is already deletion-requested.
 */
async function finishIfAlreadyDeletionRequested(
  token: string,
  deps: RequestAccountDeletionDeps,
): Promise<RequestAccountDeletionResult> {
  let decoded: VerifiedToken;
  try {
    decoded = await deps.verifyIdToken(token);
  } catch (error) {
    if (isAuthError(error)) return signInAgain();
    throw error;
  }

  if (!decoded?.uid) return signInAgain();

  const profile = await readProfile(deps, decoded.uid);
  if (!isDeletionRequestedStatus(profile?.status)) return signInAgain();

  await ensureAuthDisabled(deps, decoded.uid);
  deps.log(deletionLogLine(decoded.uid, roleForLog(roleOf(profile))));
  return { status: 200, body: { ok: true, disabled: true } };
}

/**
 * POST /api/account/request-deletion.
 * Writes users/{uid} before disabling Auth so a failed write cannot lock the
 * account. Touches Auth and users/{uid} only. No lead, visit, knock,
 * disposition, territory, or history reads or writes, and no collection scans.
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
    if (isDisabledOrRevokedAuthError(error)) {
      return finishIfAlreadyDeletionRequested(token, input.deps);
    }
    if (isAuthError(error)) return signInAgain();
    throw error;
  }

  if (!decoded?.uid) return signInAgain();

  const uid = decoded.uid;
  const profile = await readProfile(input.deps, uid);
  const role = roleOf(profile);

  if (role === 'admin') {
    return { status: 403, body: { ok: false, error: ADMIN_SELF_DELETE_ERROR } };
  }

  const alreadyRequested = isDeletionRequestedStatus(profile?.status);
  if (!alreadyRequested) {
    try {
      await input.deps.db.collection(USERS).doc(uid).set(
        {
          isActive: false,
          status: DELETION_REQUESTED_STATUS,
          deletionRequestedAt: input.deps.serverTimestamp(),
        },
        { merge: true },
      );
    } catch {
      return { status: 500, body: { ok: false, error: 'Internal error' } };
    }
  }

  await ensureAuthDisabled(input.deps, uid);
  if (!alreadyRequested) {
    await input.deps.auth.revokeRefreshTokens(uid);
  }

  input.deps.log(deletionLogLine(uid, roleForLog(role)));
  return { status: 200, body: { ok: true, disabled: true } };
}
