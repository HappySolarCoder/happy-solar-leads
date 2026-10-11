import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Timestamp } from 'firebase/firestore';
import { auth, firebaseConfig } from '@/app/utils/firebase';

export function restValue(value: unknown): Record<string, unknown> {
  if (value == null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value instanceof Timestamp) return { timestampValue: value.toDate().toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isSafeInteger(value)
    ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(restValue) } };
  if (typeof value === 'object') return { mapValue: { fields: restFields(value as Record<string, unknown>) } };
  throw Error('This lead contains an unsupported value. It remains unsynced.');
}
export function restFields(data: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, restValue(v)]));
}
/** A rep may CREATE a new manual lead without being allowed to READ a nonexistent
 * lead. Use Firestore's create precondition, not read-then-set or a destructive retry.
 * Authenticated with the rep's Firebase token; all existing security rules apply.
 */
export async function createLeadOnce(id: string, uid: string, data: Record<string, unknown>) {
  if (!/^[\w-]{1,128}$/.test(id)) throw Error('Invalid lead ID.');
  const user = auth?.currentUser;
  if (!user || user.uid !== uid) throw Error('Sign in again to sync this lead.');
  const token = await user.getIdToken();
  if (auth?.currentUser?.uid !== uid) throw Error('Account changed before sync.');
  const database = `projects/${firebaseConfig.projectId}/databases/(default)`;
  const url = `https://firestore.googleapis.com/v1/${database}/documents:commit`;
  const payload = { writes: [{ update: { name: `${database}/documents/leads/${id}`, fields: restFields(data) },
    currentDocument: { exists: false } }] };
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let status: number, body: { error?: { status?: string; message?: string } };
  if (Capacitor.isNativePlatform()) {
    const result = await CapacitorHttp.request({ url, method: 'POST', headers, data: payload,
      responseType: 'json', connectTimeout: 15000, readTimeout: 30000, disableRedirects: true });
    status = result.status;
    body = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
  } else {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
    status = response.status; body = await response.json();
  }
  if (status >= 200 && status < 300) return true;
  if (['ALREADY_EXISTS', 'FAILED_PRECONDITION'].includes(body.error?.status || '')) return false;
  throw Object.assign(Error(`Lead creation did not sync (${body.error?.status || status}). Your saved action is retained.`),
    { status: status === 403 ? 403 : status === 400 ? 400 : undefined });
}
