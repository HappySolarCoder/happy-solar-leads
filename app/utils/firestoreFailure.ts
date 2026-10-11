// Only known Firebase codes are exposed. Error messages can contain document
// paths or console links, so do not put the raw exception in native diagnostics.
const codes = new Set(['cancelled', 'unknown', 'invalid-argument', 'deadline-exceeded',
  'not-found', 'already-exists', 'permission-denied', 'resource-exhausted',
  'failed-precondition', 'aborted', 'out-of-range', 'unimplemented', 'internal',
  'unavailable', 'data-loss', 'unauthenticated']);

export function firestoreFailure(error: unknown) {
  const raw = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const value = raw.replace(/^firestore\//, '');
  const code = codes.has(value) ? value : 'unknown';
  const retryOnReconnect = ['unavailable', 'deadline-exceeded', 'aborted', 'internal', 'cancelled'].includes(code);
  let message = 'Live leads could not load. Retry, or share this error code with your admin.';
  if (code === 'permission-denied') message = 'Firestore denied access to these leads. Contact your admin with this code.';
  else if (code === 'unauthenticated') message = 'Your lead connection needs a valid sign-in. Retry, or sign in again.';
  else if (code === 'failed-precondition') message = 'Firestore could not run the lead query. Contact your admin with this code.';
  else if (code === 'resource-exhausted') message = 'Firestore is at its limit. Please wait before retrying.';
  else if (retryOnReconnect) message = 'The lead connection was interrupted. Retry when connected.';
  return { code, retryOnReconnect, message: `${message} (${code})` };
}
