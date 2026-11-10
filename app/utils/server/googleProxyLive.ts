import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import type { GoogleProxyDeps } from './googleProxy';

/** Production wiring: Admin SDK token check, real fetch, the server-only GOOGLE_API_KEY. */
export function liveGoogleProxyDeps(): GoogleProxyDeps {
  return {
    verifyIdToken: (token, checkRevoked) => adminAuth().verifyIdToken(token, checkRevoked),
    getUser: async (uid) => {
      const doc = await adminDb().collection('users').doc(uid).get();
      return { exists: doc.exists, data: doc.data() };
    },
    fetch: (input, init) => fetch(input, init),
    apiKey: () => process.env.GOOGLE_API_KEY,
  };
}
