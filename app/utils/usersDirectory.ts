import type { User } from '@/app/types';

export function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = String((error as { code?: unknown }).code || '');
  return code === 'permission-denied' || code.endsWith('/permission-denied');
}

/**
 * Directory reads fail closed for the demo and other non-roster accounts.
 * Return the signed-in session profile so Team Performance can still render
 * that person's row. Do not treat the fallback as a cached full directory.
 */
export function rosterOnDirectoryError(
  error: unknown,
  sessionUser: User | null,
  cached: User[] | null,
): User[] {
  if (isPermissionDenied(error) && sessionUser) return [sessionUser];
  return cached ?? [];
}
