import { Capacitor, CapacitorHttp } from '@capacitor/core';

/** Preserve the web webhook payload; native HTTP avoids WebView CORS failures.
 * Never auto-retry a scheduling request: providers may already have delivered it.
 */
export async function sendSchedulingWebhook(url: string, payload: Record<string, string>) {
  if (!Capacitor.isNativePlatform()) return fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  return nativeSchedulingWebhook(url, payload);
}
export async function nativeSchedulingWebhook(url: string, payload: Record<string, string>,
  request: typeof CapacitorHttp.request = options => CapacitorHttp.request(options)) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password)
    throw Error('The Scheduling Manager webhook must use HTTPS.');
  const result = await request({ url: target.href, method: 'POST',
    headers: { 'Content-Type': 'application/json' }, data: payload,
    responseType: 'text', connectTimeout: 15000, readTimeout: 30000, disableRedirects: true });
  return new Response([204, 205, 304].includes(result.status) ? null :
    typeof result.data === 'string' ? result.data : JSON.stringify(result.data),
  { status: result.status, headers: result.headers });
}
