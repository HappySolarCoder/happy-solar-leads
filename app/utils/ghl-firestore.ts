import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let ghlApp: App | null = null;

function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('ghl-not-configured');
  const parsed = JSON.parse(raw);
  if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  return parsed;
}

export function getGhlApp() {
  if (ghlApp) return ghlApp;
  const existing = getApps().find((a) => a.name === 'ghl-admin-app');
  if (existing) {
    ghlApp = existing;
    return ghlApp;
  }

  const serviceAccount = parseServiceAccount();
  const projectId = process.env.GCP_PROJECT_ID || serviceAccount.project_id;
  ghlApp = initializeApp({
    credential: cert(serviceAccount),
    projectId,
  }, 'ghl-admin-app');
  return ghlApp;
}

export function getGhlDb() {
  const dbId = process.env.FIRESTORE_DATABASE_ID;
  return dbId ? getFirestore(getGhlApp(), dbId) : getFirestore(getGhlApp());
}

export async function getGhlOpportunitiesAsync() {
  const collectionName = process.env.GHL_OPPORTUNITIES_COLLECTION || 'opportunities';
  const snap = await getGhlDb().collection(collectionName).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}
