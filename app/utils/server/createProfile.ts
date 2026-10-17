import { bearerToken, isAuthError, type VerifiedToken } from './requireApprovedUser';

export const SELF_SIGNUP_CLOSED = 'Self sign-up is closed. Ask your manager for an account.';

export const REQUESTED_ROLES = ['setter', 'closer', 'manager', 'admin'] as const;
export type RequestedRole = (typeof REQUESTED_ROLES)[number];

export class ProfileExistsError extends Error {
  constructor() {
    super('Profile already exists');
    this.name = 'ProfileExistsError';
  }
}

export function sanitizeRequestedRole(value: unknown): RequestedRole {
  const role = String(value ?? '').trim().toLowerCase();
  return (REQUESTED_ROLES as readonly string[]).includes(role) ? (role as RequestedRole) : 'setter';
}

export function buildPendingProfile(input: {
  uid: string;
  name: string;
  email: string;
  requestedRole: RequestedRole;
  createdAt: Date;
  color: string;
}): Record<string, unknown> {
  return {
    id: input.uid,
    name: input.name,
    email: input.email,
    role: 'setter',
    requestedRole: input.requestedRole,
    approved: false,
    approvalStatus: 'pending',
    approvalRequestedAt: input.createdAt,
    createdAt: input.createdAt,
    status: 'Pending Approval',
    isActive: false,
    color: input.color,
  };
}

export function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'already-exists' || code === 6 || code === 'ALREADY_EXISTS';
}

export async function handleCreateProfile(input: {
  authorization: string | null;
  body: unknown;
  signupEnabled: boolean;
  deps: {
    verifyIdToken: (token: string, checkRevoked: true) => Promise<VerifiedToken>;
    createUserDoc: (uid: string, data: Record<string, unknown>) => Promise<void>;
    now?: () => Date;
    color?: () => string;
  };
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!input.signupEnabled) {
    return { status: 403, body: { error: SELF_SIGNUP_CLOSED } };
  }

  const token = bearerToken(input.authorization);
  if (!token) return { status: 401, body: { error: 'Missing credentials' } };

  let decoded: VerifiedToken;
  try {
    decoded = await input.deps.verifyIdToken(token, true);
  } catch (error) {
    if (isAuthError(error)) return { status: 401, body: { error: 'Sign in again.' } };
    throw error;
  }

  if (!decoded?.uid) return { status: 401, body: { error: 'Sign in again.' } };

  const record = input.body && typeof input.body === 'object' ? (input.body as Record<string, unknown>) : {};
  const name = String(record.name ?? '').trim();
  const email = String(decoded.email ?? '').trim();
  if (!name) return { status: 400, body: { error: 'Name is required' } };
  if (!email) return { status: 400, body: { error: 'Email is required' } };

  const requestedRole = sanitizeRequestedRole(record.requestedRole);
  const createdAt = input.deps.now?.() ?? new Date();
  const color = input.deps.color?.() ?? '#336699';
  const profile = buildPendingProfile({
    uid: decoded.uid,
    name,
    email,
    requestedRole,
    createdAt,
    color,
  });

  try {
    await input.deps.createUserDoc(decoded.uid, profile);
  } catch (error) {
    if (error instanceof ProfileExistsError) {
      return { status: 409, body: { error: 'Account already exists' } };
    }
    throw error;
  }

  return { status: 200, body: { success: true, needsApproval: true, assignedRole: 'setter' } };
}
