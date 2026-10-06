import { App, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

let adminApp: App | null = null;

function getServiceAccount() {
  // User-admin routes read FIREBASE_SERVICE_ACCOUNT. FIREBASE_SERVICE_ACCOUNT_JSON
  // is the same credential shape (also used by the GHL client). Prefer the admin
  // name, and fall back only when that one is unset.
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_JSON env variable');
  }
  const parsed = JSON.parse(raw);
  if (parsed.private_key) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
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
