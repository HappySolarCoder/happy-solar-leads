import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export type GhlDoc = Record<string, unknown> & { id: string };

let ghlApp: App | null = null;

function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('ghl-not-configured');
  const parsed = JSON.parse(raw);
  if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  return parsed;
}

function getCollectionName(envKey: string, fallback: string) {
  const value = process.env[envKey];
  return value && value.trim() ? value.trim() : fallback;
}

export function normalizePhoneToLast10(phone: unknown) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
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

export async function getGhlContactsAsync(): Promise<GhlDoc[]> {
  const snap = await getGhlDb().collection(getCollectionName('GHL_CONTACTS_COLLECTION', 'ghl_contacts_v2')).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
}

export async function getGhlOpportunitiesAsync(): Promise<GhlDoc[]> {
  const snap = await getGhlDb().collection(getCollectionName('GHL_OPPORTUNITIES_COLLECTION', 'ghl_opportunities_v2')).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
}

export async function getGhlPipelinesAsync(): Promise<GhlDoc[]> {
  const snap = await getGhlDb().collection(getCollectionName('GHL_PIPELINES_COLLECTION', 'ghl_pipelines_v2')).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
}

export async function getGhlAppointmentEventsAsync(): Promise<GhlDoc[]> {
  const candidates = [
    process.env.GHL_APPOINTMENT_EVENTS_COLLECTION,
    'ghl_appointment_events_v2',
    'ghl_calendar_events_v2',
    'ghl_appointments_v2',
  ].filter((value, index, arr): value is string => !!value && arr.indexOf(value) === index);

  for (const collectionName of candidates) {
    try {
      const snap = await getGhlDb().collection(collectionName).get();
      if (!snap.empty) {
        return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
      }
    } catch {
      // Try next candidate collection name.
    }
  }

  return [];
}
