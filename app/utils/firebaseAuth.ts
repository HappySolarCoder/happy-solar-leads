import type { FirebaseApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from 'firebase/auth';

export function initializeClientAuth(app: FirebaseApp, nativeBuild: boolean, platform: string) {
  if (nativeBuild && (platform === 'ios' || platform === 'android')) {
    // Raydar uses email/password. getAuth's browser popup/redirect resolver
    // proactively loads a Google iframe on iOS before notifying auth listeners.
    // That unused browser flow can stall inside Capacitor's WebView.
    // Keep the existing persistence order and keys so signed-in reps stay signed in.
    return initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
    });
  }
  return getAuth(app);
}
