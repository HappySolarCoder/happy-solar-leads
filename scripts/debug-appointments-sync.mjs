import fs from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const envPath = '/tmp/raydar-vercel-env';
if (!fs.existsSync(envPath)) {
  console.error('Missing env pull at', envPath);
  process.exit(1);
}

const envText = fs.readFileSync(envPath, 'utf8');
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf('=');
      return [line.slice(0, idx), line.slice(idx + 1)];
    })
);

const serviceAccountRaw = env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountRaw || serviceAccountRaw === '""') {
  console.error('FIREBASE_SERVICE_ACCOUNT_JSON unavailable from env pull');
  process.exit(2);
}

const serviceAccount = JSON.parse(serviceAccountRaw);
if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
const projectId = env.GCP_PROJECT_ID && env.GCP_PROJECT_ID !== '""' ? env.GCP_PROJECT_ID : serviceAccount.project_id;
const dbId = env.FIRESTORE_DATABASE_ID && env.FIRESTORE_DATABASE_ID !== '""' ? env.FIRESTORE_DATABASE_ID : undefined;

const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount), projectId }, 'debug-ghl');
const db = dbId ? getFirestore(app, dbId) : getFirestore(app);

const nameQuery = process.argv.slice(2).join(' ').trim();
if (!nameQuery) {
  console.error('Usage: node scripts/debug-appointments-sync.mjs "Omayra Z"');
  process.exit(3);
}

const leadsSnap = await db.collection('leads').where('name', '>=', nameQuery).where('name', '<=', nameQuery + '\uf8ff').get().catch(() => null);
console.log('lead query on current db:', leadsSnap?.size ?? 'n/a');

const contactsCol = env.GHL_CONTACTS_COLLECTION && env.GHL_CONTACTS_COLLECTION !== '""' ? env.GHL_CONTACTS_COLLECTION : 'ghl_contacts_v2';
const oppsCol = env.GHL_OPPORTUNITIES_COLLECTION && env.GHL_OPPORTUNITIES_COLLECTION !== '""' ? env.GHL_OPPORTUNITIES_COLLECTION : 'ghl_opportunities_v2';
const eventCols = [env.GHL_APPOINTMENT_EVENTS_COLLECTION, 'ghl_appointment_events_v2', 'ghl_calendar_events_v2', 'ghl_appointments_v2'].filter(Boolean);

for (const col of [contactsCol, oppsCol, ...eventCols]) {
  try {
    const snap = await db.collection(col).limit(1).get();
    console.log(col, 'exists?', !snap.empty || snap.size === 0);
  } catch (error) {
    console.log(col, 'error', String(error));
  }
}
