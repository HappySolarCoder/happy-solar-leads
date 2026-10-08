import { Capacitor, CapacitorHttp } from '@capacitor/core';

/** Only app API paths can be sent to the configured backend. */
export function resolveApiUrl(path: string, origin: string): string {
  if (!path.startsWith('/api/') || path.includes('\\')) {
    throw new Error('Expected an app API path');
  }
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password ||
      base.pathname !== '/' || base.search || base.hash) {
    throw new Error('NEXT_PUBLIC_API_BASE_URL must be an HTTPS origin');
  }
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith('/api/')) {
    throw new Error('API path must stay within /api/');
  }
  return url.href;
}

/** Existing web behavior, with native HTTP for the installed app's JSON APIs.
 * Explicitly preserves callers' bearer tokens; never patches Firebase's transport.
 * Native requests deliberately do not follow redirects with credentials.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!Capacitor.isNativePlatform()) return fetch(path, init);
  return nativeApiFetch(path, init);
}

export async function nativeApiFetch(
  path: string,
  init: RequestInit = {},
  request: typeof CapacitorHttp.request = options => CapacitorHttp.request(options),
): Promise<Response> {
  const origin = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!origin) throw new Error('The mobile API origin is not configured');
  const url = resolveApiUrl(path, origin);
  init.signal?.throwIfAborted();
  const headers = new Headers(init.headers);
  if (init.body != null && typeof init.body !== 'string') {
    throw new Error('Native API requests require a serialized JSON or text body');
  }
  const data = typeof init.body === 'string' && headers.get('content-type')?.includes('application/json')
    ? JSON.parse(init.body) : init.body ?? undefined;
  const result = await request({
    url,
    method: init.method ?? 'GET',
    headers: Object.fromEntries(headers.entries()),
    data,
    responseType: 'text',
    connectTimeout: 15000,
    readTimeout: 60000,
    disableRedirects: true,
  });
  // The native transport cannot cancel in flight, but don't deliver an aborted result.
  init.signal?.throwIfAborted();
  const noBody = init.method === 'HEAD' || [204, 205, 304].includes(result.status);
  return new Response(noBody ? null : typeof result.data === 'string'
    ? result.data : JSON.stringify(result.data), {
    status: result.status,
    headers: result.headers,
  });
}
