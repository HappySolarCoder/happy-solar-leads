import type { FirestoreSettings } from 'firebase/firestore';

export function nativeFirestoreSettings(nativeBuild: boolean, platform: string): FirestoreSettings | null {
  // WebKit can buffer streaming responses until the next keep-alive. Use
  // closed responses only in the installed iOS app. No new reads/listeners.
  // https://github.com/firebase/firebase-js-sdk/issues/9789
  return nativeBuild && platform === 'ios'
    ? { experimentalForceLongPolling: true } : null;
}
