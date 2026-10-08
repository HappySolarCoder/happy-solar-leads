import { createHash, timingSafeEqual } from 'crypto';

/**
 * Server-to-server provisioning for Bloom.
 * Firestore shape matches Admin → User Management → Create User
 * (app/admin/users/page.tsx handleCreateUser): an approved, active rep.
 * Field Marketing Agents are stored as role "setter" — that is the field-rep
 * role Raydar already uses.
 */

/** Bloom may only create field reps. Manager and admin stay manual in User Management. */
export type ProvisionRole = 'setter' | 'closer';

export type ProvisionDeps = {
  getUserByEmail: (email: string) => Promise<{ uid: string } | null>;
  getProfileExists: (uid: string) => Promise<boolean>;
  createUser: (input: { email: string; password: string; displayName: string }) => Promise<{ uid: string }>;
  setUserDoc: (uid: string, data: Record<string, unknown>) => Promise<void>;
  deleteUser: (uid: string) => Promise<void>;
  now?: () => Date;
  color?: () => string;
};

export type ProvisionSuccess = { ok: true; uid: string; created: boolean };
export type ProvisionFailure = { ok: false; status: number; error: string };
export type ProvisionResult = ProvisionSuccess | ProvisionFailure;

const ROLE_ALIASES: Record<string, ProvisionRole> = {
  setter: 'setter',
  fma: 'setter',
  'field marketing agent': 'setter',
  'field marketing': 'setter',
  closer: 'closer',
};

export function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export function readBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

/** Missing, malformed, or wrong bearer tokens are all unauthorized. */
export function isProvisionAuthorized(authorizationHeader: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const token = readBearerToken(authorizationHeader);
  return secretsMatch(token ?? '', secret);
}

export function normalizeProvisionRole(role: string): ProvisionRole | null {
  const key = role.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  return ROLE_ALIASES[key] ?? null;
}

export function randomUserColor(): string {
  return `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
}

export function buildProvisionedUserDoc(input: {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  role: ProvisionRole;
  territory?: string;
  createdAt: Date;
  color: string;
}): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    id: input.uid,
    name: `${input.firstName} ${input.lastName}`.trim(),
    email: input.email,
    role: input.role,
    requestedRole: input.role,
    approved: true,
    approvalStatus: 'approved',
    createdAt: input.createdAt,
    status: 'active',
    isActive: true,
    color: input.color,
    mustChangePassword: true,
  };
  if (input.territory) doc.territory = input.territory;
  return doc;
}

type ParsedBody = {
  email: string;
  firstName: string;
  lastName: string;
  role: ProvisionRole;
  territory?: string;
  tempPassword: string;
};

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code || '');
  }
  return '';
}

function parseProvisionBody(body: unknown): { ok: true; value: ParsedBody } | ProvisionFailure {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'Invalid JSON body' };
  }
  const raw = body as Record<string, unknown>;
  const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
  const firstName = typeof raw.firstName === 'string' ? raw.firstName.trim() : '';
  const lastName = typeof raw.lastName === 'string' ? raw.lastName.trim() : '';
  const roleRaw = typeof raw.role === 'string' ? raw.role : '';
  const tempPassword = typeof raw.tempPassword === 'string' ? raw.tempPassword : '';

  if (!email || !firstName || !lastName || !roleRaw || !tempPassword) {
    return { ok: false, status: 400, error: 'email, firstName, lastName, role, and tempPassword are required' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, status: 400, error: 'Invalid email' };
  }
  const role = normalizeProvisionRole(roleRaw);
  if (!role) {
    return { ok: false, status: 400, error: 'Invalid role' };
  }
  if (tempPassword.length < 6) {
    return { ok: false, status: 400, error: 'Password does not meet requirements' };
  }

  let territory: string | undefined;
  if (raw.territory != null && raw.territory !== '') {
    if (typeof raw.territory !== 'string') {
      return { ok: false, status: 400, error: 'territory must be a string' };
    }
    const trimmed = raw.territory.trim();
    if (trimmed) territory = trimmed;
  }

  return { ok: true, value: { email, firstName, lastName, role, territory, tempPassword } };
}

async function writeProfileIfMissing(
  uid: string,
  value: ParsedBody,
  deps: ProvisionDeps,
): Promise<void> {
  const exists = await deps.getProfileExists(uid);
  if (exists) return;
  const now = deps.now ? deps.now() : new Date();
  const color = deps.color ? deps.color() : randomUserColor();
  await deps.setUserDoc(uid, buildProvisionedUserDoc({
    uid,
    email: value.email,
    firstName: value.firstName,
    lastName: value.lastName,
    role: value.role,
    territory: value.territory,
    createdAt: now,
    color,
  }));
}

export async function provisionFieldUser(body: unknown, deps: ProvisionDeps): Promise<ProvisionResult> {
  const parsed = parseProvisionBody(body);
  if (!parsed.ok) return parsed;
  const value = parsed.value;

  const existing = await deps.getUserByEmail(value.email);
  if (existing) {
    await writeProfileIfMissing(existing.uid, value, deps);
    return { ok: true, uid: existing.uid, created: false };
  }

  let uid: string;
  try {
    const created = await deps.createUser({
      email: value.email,
      password: value.tempPassword,
      displayName: `${value.firstName} ${value.lastName}`.trim(),
    });
    uid = created.uid;
  } catch (error) {
    const code = errorCode(error);
    if (code === 'auth/email-already-exists') {
      const again = await deps.getUserByEmail(value.email);
      if (!again) throw error;
      await writeProfileIfMissing(again.uid, value, deps);
      return { ok: true, uid: again.uid, created: false };
    }
    if (code === 'auth/invalid-password' || code === 'auth/weak-password') {
      return { ok: false, status: 400, error: 'Password does not meet requirements' };
    }
    throw error;
  }

  try {
    const now = deps.now ? deps.now() : new Date();
    const color = deps.color ? deps.color() : randomUserColor();
    await deps.setUserDoc(uid, buildProvisionedUserDoc({
      uid,
      email: value.email,
      firstName: value.firstName,
      lastName: value.lastName,
      role: value.role,
      territory: value.territory,
      createdAt: now,
      color,
    }));
  } catch (error) {
    try {
      await deps.deleteUser(uid);
    } catch {
      // Profile write failed and Auth rollback failed. Caller returns 500.
    }
    throw error;
  }

  return { ok: true, uid, created: true };
}

export async function handleProvisionPost(options: {
  authorization: string | null;
  secret: string | undefined;
  body: unknown;
  deps: ProvisionDeps;
  logger?: (message: string) => void;
}): Promise<{ status: number; body: { uid?: string; created?: boolean; error?: string } }> {
  if (!isProvisionAuthorized(options.authorization, options.secret)) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  try {
    const result = await provisionFieldUser(options.body, options.deps);
    if (!result.ok) return { status: result.status, body: { error: result.error } };
    return { status: 200, body: { uid: result.uid, created: result.created } };
  } catch (error) {
    const code = errorCode(error) || 'unknown';
    options.logger?.(`[api/admin/provision-user] ${code}`);
    return { status: 500, body: { error: 'Internal error' } };
  }
}
