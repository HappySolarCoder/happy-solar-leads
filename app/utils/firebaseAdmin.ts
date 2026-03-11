import admin from 'firebase-admin';

function getServiceAccountFromEnv() {
  // Preferred: full JSON in one env var
  const jsonRaw =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (jsonRaw) {
    try {
      return JSON.parse(jsonRaw);
    } catch {
      // Sometimes set as base64
      const b64 = Buffer.from(jsonRaw, 'base64').toString('utf8');
      return JSON.parse(b64);
    }
  }

  // Common split env vars
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT;

  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL ||
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL;

  const privateKeyRaw =
    process.env.FIREBASE_PRIVATE_KEY ||
    process.env.FIREBASE_ADMIN_PRIVATE_KEY ||
    process.env.GOOGLE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKeyRaw) {
    // Vercel often stores newlines escaped
    const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
    return { projectId, clientEmail, privateKey };
  }

  return null;
}

export function adminDb() {
  if (!admin.apps.length) {
    const sa = getServiceAccountFromEnv();

    if (sa) {
      admin.initializeApp({ credential: admin.credential.cert(sa as any) });
    } else {
      // Fallback: application default credentials (works on some deployments)
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
  }

  return admin.firestore();
}
