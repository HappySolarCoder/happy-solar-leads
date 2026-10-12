import type { FirestoreSettings } from 'firebase/firestore';

export function nativeFirestoreSettings(nativeBuild: boolean, platform: string): FirestoreSettings | null {
  // Forcing long polling closes each response as soon as data arrives. Large
  // initial snapshots then pay for many serial round trips (observed in v14.3).
  // Let the SDK stream and detect buffering when a long-poll fallback is needed.
  // This changes transport only: no extra queries, listeners, or data writes.
  // https://firebase.google.com/docs/reference/js/firestore.firestoresettings
  return nativeBuild && platform === 'ios'
    ? { experimentalAutoDetectLongPolling: true } : null;
}
