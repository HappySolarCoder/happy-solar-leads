import { auth } from '@/app/utils/firebase';
import { apiFetch } from '@/app/utils/apiFetch';
import { makeAuthedFetch } from '@/app/utils/authedFetchCore';

/**
 * fetch for the app's Google proxy routes (/api/geocode, /api/solar, /api/route): adds
 * `Authorization: Bearer <Firebase ID token>` when someone is signed in, and never overwrites an
 * Authorization header the caller supplied.
 *
 * It always sends through apiFetch, the transport that knows where the backend is. On the web that is
 * a plain same-origin fetch; in the native app it is CapacitorHttp against NEXT_PUBLIC_API_BASE_URL.
 * Never call bare `fetch` here: on the mobile line a relative '/api/...' would not reach the backend.
 */
export const authedFetch = makeAuthedFetch(async () => auth?.currentUser?.getIdToken(), apiFetch);
