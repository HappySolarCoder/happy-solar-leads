import { HttpError, requireApprovedUser, type RequireApprovedUserDeps } from './requireApprovedUser';
import { randomUserColor } from '../provisionUser';

/**
 * Admin → User Management → Create User, done with the Admin SDK so it keeps
 * working after Firebase self-signup is turned off. The users doc matches
 * app/admin/users/page.tsx handleCreateUser. The Auth user is deleted if the
 * doc write fails.
 */

export type AdminCreateRole = 'setter' | 'closer' | 'manager' | 'admin';

const ROLES: readonly AdminCreateRole[] = ['setter', 'closer', 'manager', 'admin'];

export type CreateAdminUserDeps = RequireApprovedUserDeps & {
  createUser: (input: { email: string; password: string; displayName: string }) => Promise<{ uid: string }>;
  setUserDoc: (uid: string, data: Record<string, unknown>) => Promise<void>;
  deleteUser: (uid: string) => Promise<void>;
  now?: () => Date;
  color?: () => string;
};

export type CreateAdminUserResult = {
  status: number;
  body: { uid?: string; error?: string };
};

type ParsedBody = {
  name: string;
  email: string;
  password: string;
  role: AdminCreateRole;
};

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code || '');
  }
  return '';
}

export function buildAdminCreatedUserDoc(input: {
  uid: string;
  name: string;
  email: string;
  role: AdminCreateRole;
  createdAt: Date;
  color: string;
}): Record<string, unknown> {
  return {
    id: input.uid,
    name: input.name,
    email: input.email,
    role: input.role,
    requestedRole: input.role,
    approved: true,
    approvalStatus: 'approved',
    createdAt: input.createdAt,
    status: 'active',
    isActive: true,
    color: input.color,
  };
}

function parseBody(body: unknown): { ok: true; value: ParsedBody } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Invalid JSON body' };
  }
  const raw = body as Record<string, unknown>;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const email = typeof raw.email === 'string' ? raw.email.trim() : '';
  const password = typeof raw.password === 'string' ? raw.password : '';
  const role = typeof raw.role === 'string' ? raw.role : '';

  if (!name || !email || !password || !role) {
    return { ok: false, error: 'name, email, password, and role are required' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Invalid email' };
  }
  if (!ROLES.includes(role as AdminCreateRole)) {
    return { ok: false, error: 'Invalid role' };
  }
  if (password.length < 6) {
    return { ok: false, error: 'Password does not meet requirements' };
  }

  return { ok: true, value: { name, email, password, role: role as AdminCreateRole } };
}

export async function handleCreateAdminUser(options: {
  authorization: string | null;
  body: unknown;
  deps: CreateAdminUserDeps;
  logger?: (message: string) => void;
}): Promise<CreateAdminUserResult> {
  let actor: { role: string };
  try {
    actor = await requireApprovedUser(options.authorization, options.deps);
  } catch (error) {
    if (error instanceof HttpError) {
      return { status: error.status, body: { error: error.message } };
    }
    const code = errorCode(error) || 'unknown';
    options.logger?.(`[api/admin/create-user] auth ${code}`);
    return { status: 500, body: { error: 'Internal error' } };
  }

  if (actor.role !== 'admin') {
    return { status: 403, body: { error: 'Not authorized' } };
  }

  const parsed = parseBody(options.body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const value = parsed.value;

  let uid: string;
  try {
    const created = await options.deps.createUser({
      email: value.email,
      password: value.password,
      displayName: value.name,
    });
    uid = created.uid;
  } catch (error) {
    const code = errorCode(error);
    if (code === 'auth/email-already-exists') {
      return { status: 409, body: { error: 'An account with that email already exists' } };
    }
    if (code === 'auth/invalid-password' || code === 'auth/weak-password') {
      return { status: 400, body: { error: 'Password does not meet requirements' } };
    }
    options.logger?.(`[api/admin/create-user] auth-create ${code || 'unknown'}`);
    return { status: 500, body: { error: 'Internal error' } };
  }

  try {
    const now = options.deps.now ? options.deps.now() : new Date();
    const color = options.deps.color ? options.deps.color() : randomUserColor();
    await options.deps.setUserDoc(uid, buildAdminCreatedUserDoc({
      uid,
      name: value.name,
      email: value.email,
      role: value.role,
      createdAt: now,
      color,
    }));
  } catch (error) {
    try {
      await options.deps.deleteUser(uid);
    } catch (rollbackError) {
      const rollbackCode = errorCode(rollbackError) || 'unknown';
      options.logger?.(`[api/admin/create-user] rollback ${rollbackCode}`);
    }
    const code = errorCode(error) || 'unknown';
    options.logger?.(`[api/admin/create-user] profile ${code}`);
    return { status: 500, body: { error: 'Internal error' } };
  }

  return { status: 200, body: { uid } };
}
