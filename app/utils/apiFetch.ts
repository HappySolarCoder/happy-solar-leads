/**
 * WEB-ONLY STUB. The Raydar native app (mobile line) ships its own app/utils/apiFetch.ts that sends
 * /api/* requests through CapacitorHttp to NEXT_PUBLIC_API_BASE_URL. When the mobile line is merged
 * into this tree, resolve the add/add conflict on this file by taking the mobile version. Every
 * caller (authedFetch included) already goes through this function, so nothing else changes.
 * tests/google-proxy.test.ts fails if the stub survives next to native (CapacitorHttp) code.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, init);
}
