import { auth } from '@/app/utils/firebase';

/**
 * fetch for same-origin app API routes that accept a Firebase ID token (the /api/geocode,
 * /api/solar and /api/route proxies). Adds `Authorization: Bearer <token>` when someone is
 * signed in; with nobody signed in, or if the token cannot be read, it is a plain fetch so the
 * call behaves exactly as before (the server decides what an unauthenticated call gets).
 */
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let token: string | undefined;
  try {
    token = await auth?.currentUser?.getIdToken();
  } catch {
    token = undefined;
  }
  if (!token) return fetch(input, init);
  const headers = new Headers(init.headers);
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
