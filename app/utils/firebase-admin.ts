import { App, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

let adminApp: App | null = null;

function normalizePrivateKey(key: string) {
  // Vercel env vars often store newlines as literal \n
  return key.replace(/\\n/g, '\n');
}

function getServiceAccount() {
  // Prefer single JSON env var(s)
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed.private_key) parsed.private_key = normalizePrivateKey(parsed.private_key);
    return parsed;
  }

  // Support split vars (common in Vercel)
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_PROJECT_ID || process.env.GCP_PROJECT;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    return {
      project_id: projectId,
      client_email: clientEmail,
      private_key: normalizePrivateKey(privateKey),
    };
  }

  throw new Error(
    'Missing Firebase Admin credentials. Expected FIREBASE_SERVICE_ACCOUNT (or FIREBASE_SERVICE_ACCOUNT_JSON) or split vars FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.'
  );
}

export function getAdminApp() {
  if (adminApp) return adminApp;

  const existing = getApps().find((app) => app.name === 'admin-app');
  if (existing) {
    adminApp = existing;
    return adminApp;
  }

  adminApp = initializeApp({
    credential: cert(getServiceAccount()),
  }, 'admin-app');

  return adminApp;
}

export function adminAuth() {
  return getAuth(getAdminApp());
}

export function adminDb() {
  return getFirestore(getAdminApp());
}
