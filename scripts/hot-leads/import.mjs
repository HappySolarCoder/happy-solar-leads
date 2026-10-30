/**
 * Dry-run by default.
 * node scripts/hot-leads/import.mjs <file.xlsx|csv> [--commit] [--retire-missing]
 *   [--include-lost] [--project <id>]
 * Do Not Contact / DNC rows are imported with doNotCall: true. --include-dnc is accepted and ignored.
 * --commit also requires HOT_LEADS_IMPORT_CONFIRM=yes.
 * A dry run never opens Firestore. Do not pass --commit in this environment.
 */
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import {
  executeCli,
  HOMEOWNER_BOUND_CAP,
  HOMEOWNER_QUERY_CAP,
  HOMEOWNER_QUERY_LIMIT,
  isCensusCsv,
  writeOwnerOnly,
} from './logic.mjs';

const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch';

async function fetchBatch(csv) {
  const form = new FormData();
  form.set('benchmark', 'Public_AR_Current');
  form.set('addressFile', new Blob([csv], { type: 'text/csv' }), 'batch.csv');
  const response = await fetch(CENSUS_URL, { method: 'POST', body: form });
  const text = await response.text();
  if (!response.ok || !isCensusCsv(text)) throw new Error('geocode_failed');
  return text;
}

async function throttle() {
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function openAdmin(projectId) {
  const { initializeApp, cert, getApp } = await import('firebase-admin/app');
  const { FieldPath, getFirestore } = await import('firebase-admin/firestore');
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('missing_credentials');
  const parsed = JSON.parse(raw);
  if (parsed.private_key) parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
  const name = 'hot-leads-import';
  let app;
  try {
    app = getApp(name);
  } catch {
    app = initializeApp({
      credential: cert(parsed),
      projectId: projectId || parsed.project_id,
    }, name);
  }
  const db = getFirestore(app);
  return {
    async get(id) {
      const snap = await db.collection('hotLeads').doc(id).get();
      return snap.exists ? snap.data() : null;
    },
    async merge(id, patch) {
      await db.collection('hotLeads').doc(id).set(patch, { merge: true });
    },
    async create(id, doc) {
      await db.collection('hotLeads').doc(id).set(doc, { merge: true });
    },
    async retire(id, patch) {
      await db.collection('hotLeads').doc(id).set(patch, { merge: true });
    },
    async homeownersNear(plan) {
      const docs = [];
      for (const query of plan.queries.slice(0, HOMEOWNER_QUERY_CAP)) {
        const pageSize = Math.min(query.limit, HOMEOWNER_QUERY_LIMIT);
        let after = null;
        let read = 0;
        while (read < HOMEOWNER_BOUND_CAP) {
          const limit = Math.min(pageSize, HOMEOWNER_BOUND_CAP - read);
          let geohashQuery = db.collection('homeowners')
            .where('geohash', '>=', query.start)
            .where('geohash', '<=', query.end)
            .orderBy('geohash')
            .orderBy(FieldPath.documentId())
            .limit(limit);
          if (after) geohashQuery = geohashQuery.startAfter(after.geohash, after.id);
          const snap = await geohashQuery.get();
          docs.push(...snap.docs.map((doc) => ({ id: doc.id, data: doc.data() })));
          read += snap.size;
          if (snap.size < limit) break;
          const last = snap.docs.at(-1);
          after = { geohash: last.get('geohash'), id: last.id };
        }
      }
      return docs;
    },
    async leadPage({ start, end, limit, after }) {
      let leadQuery = db.collection('leads')
        .where('lat', '>=', start)
        .where('lat', '<=', end)
        .orderBy('lat')
        .orderBy(FieldPath.documentId())
        .limit(limit);
      if (after) leadQuery = leadQuery.startAfter(after.lat, after.id);
      const snap = await leadQuery.get();
      return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
    async listHotLeads({ limit, afterId }) {
      const page = Math.min(limit, 200);
      let query = db.collection('hotLeads').orderBy(FieldPath.documentId()).select('hotStatus').limit(page);
      if (afterId) query = query.startAfter(afterId);
      const snap = await query.get();
      return snap.docs.map((doc) => ({ id: doc.id, hotStatus: doc.get('hotStatus') ?? null }));
    },
  };
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const commit = process.argv.includes('--commit');
  const confirmed = process.env.HOT_LEADS_IMPORT_CONFIRM === 'yes';
  executeCli(process.argv.slice(2), {
    env: process.env,
    readFile: (file) => readFile(file),
    readOptional: async (file) => {
      try {
        return await readFile(file, 'utf8');
      } catch {
        return null;
      }
    },
    writeFile: (file, text) => writeOwnerOnly(file, text),
    fetchBatch,
    throttle,
    connect: commit && confirmed ? openAdmin : null,
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result.output)}\n`);
    process.exitCode = result.code;
  }).catch(() => {
    process.stdout.write(`${JSON.stringify({ error: 'import_failed', writes: 0 })}\n`);
    process.exitCode = 1;
  });
}
