export type Transport = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * Builds a fetch that adds `Authorization: Bearer <token>` when `getToken` returns one.
 * Never overwrites an Authorization header the caller supplied; if there is no token (nobody signed in,
 * or the token read fails) the request goes out unchanged. Everything else in `init` (signal, method,
 * body, other headers) is passed through untouched.
 */
export function makeAuthedFetch(getToken: () => Promise<string | undefined>, transport: Transport) {
  return async (input: string, init: RequestInit = {}): Promise<Response> => {
    if (new Headers(init.headers).has('Authorization')) return transport(input, init);
    let token: string | undefined;
    try {
      token = await getToken();
    } catch {
      token = undefined;
    }
    if (!token) return transport(input, init);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return transport(input, { ...init, headers });
  };
}
