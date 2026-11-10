/**
 * Backfill fieldKnockEvents from refused fieldSyncReports (events only).
 *
 *   node scripts/field-knock-backfill/run.mjs                      dry run (default, read-only)
 *   node scripts/field-knock-backfill/run.mjs --since <ISO>        change the window (default 2026-11-01 Phoenix)
 *   node scripts/field-knock-backfill/run.mjs --summary-out f.json also write the summary (counts only)
 *   node scripts/field-knock-backfill/run.mjs --commit --plan-hash <hash>   apply (needs FIELD_KNOCK_BACKFILL_CONFIRM=yes)
 *   node scripts/field-knock-backfill/run.mjs --undo bf-<12 hex>            dry run of an undo
 *   node scripts/field-knock-backfill/run.mjs --undo bf-<12 hex> --commit   delete that run's events only
 *
 * Dry run builds a READ-ONLY adapter: the writer does not exist unless --commit
 * and the confirm env are both present. Apply re-plans and refuses unless the
 * plan hash equals the hash of the dry run you reviewed. Writes are create-only
 * (a second run creates nothing: planned ids that exist are skipped), 100 docs
 * per batch, to fieldKnockEvents only: no lead, receipt or history is touched.
 * Undo deletes only docs whose backfillRunId equals the run id and source is 'backfill'.
 * DO NOT run --commit without Charles's approval.
 */
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { BATCH_SIZE, MAX_REPORTS, buildPlan, chunk, parseArgs, summarize } from './logic.mjs';

const REPORT_FIELDS = ['uid', 'userName', 'draftId', 'leadId', 'intendedStatus', 'actionAt', 'outcome', 'reasonCode', 'createdAt'];

export async function execute({ args, reader, makeWriter, log }) {
  if (args.errors.length) throw new Error(args.errors.join('; '));
  if (args.undo) return undo({ args, reader, makeWriter, log });
  const reports = await reader.reports(args.sinceMs);
  const refused = reports.filter((r) => r.outcome === 'refused' && r.reasonCode === 'owned_by_other');
  const ids = refused.map((r) => `${r.uid}_${r.draftId}`);
  const existingEvents = await reader.existing('fieldKnockEvents', ids);
  const receipts = await reader.existing('fieldDispoReceipts', ids);
  const leadIds = [...new Set(refused.map((r) => r.leadId).filter(Boolean))];
  const historyByLead = await reader.histories(leadIds);
  const plan = buildPlan({ reports, existingEvents, receipts, historyByLead, sinceMs: args.sinceMs });
  const summary = summarize(plan);
  summary.reportsRead = reports.length;
  if (!args.commit) {
    log(JSON.stringify(summary, null, 2));
    return { plan, summary };
  }
  if (args.planHash !== plan.planHash) {
    throw new Error(`plan hash mismatch: reviewed ${args.planHash}, current ${plan.planHash}. Re-run the dry run.`);
  }
  const writer = makeWriter();
  let created = 0;
  for (const batch of chunk(plan.docs, BATCH_SIZE)) {
    await writer.createEvents(batch);
    created += batch.length;
  }
  summary.mode = 'applied';
  summary.created = created;
  log(JSON.stringify(summary, null, 2));
  return { plan, summary };
}

async function undo({ args, reader, makeWriter, log }) {
  const found = await reader.eventsOfRun(args.undo);
  const ids = found.filter((d) => d.source === 'backfill' && d.backfillRunId === args.undo).map((d) => d.id);
  const summary = { mode: args.commit ? 'undo-applied' : 'undo-dry-run', runId: args.undo, events: ids.length };
  if (args.commit) {
    const writer = makeWriter();
    for (const batch of chunk(ids, BATCH_SIZE)) await writer.deleteEvents(batch);
  }
  log(JSON.stringify(summary, null, 2));
  return { summary };
}

async function openFirestore(projectId) {
  const { initializeApp, cert, getApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp, FieldValue } = await import('firebase-admin/firestore');
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('missing_credentials');
  const parsed = JSON.parse(raw);
  if (parsed.private_key) parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
  const name = 'field-knock-backfill';
  let app;
  try { app = getApp(name); } catch {
    app = initializeApp({ credential: cert(parsed), ...(projectId ? { projectId } : {}) }, name);
  }
  return { db: getFirestore(app), Timestamp, FieldValue };
}

/** Read-only by construction: this object has no write methods. Every read is bounded. */
export function firestoreReader({ db, Timestamp }) {
  return {
    async reports(sinceMs) {
      const out = [];
      let last = null;
      while (out.length < MAX_REPORTS) {
        let q = db.collection('fieldSyncReports')
          .where('createdAt', '>=', Timestamp.fromMillis(sinceMs))
          .orderBy('createdAt')
          .select(...REPORT_FIELDS)
          .limit(500);
        if (last) q = q.startAfter(last);
        const snap = await q.get();
        for (const doc of snap.docs) out.push({ id: doc.id, ...doc.data() });
        if (snap.docs.length < 500) break;
        last = snap.docs[snap.docs.length - 1];
      }
      if (out.length >= MAX_REPORTS) throw new Error('too many reports; refusing to plan on a truncated read');
      return out;
    },
    async existing(collection, ids) {
      const found = new Set();
      for (const part of chunk(ids, 300)) {
        if (!part.length) continue;
        const refs = part.map((id) => db.collection(collection).doc(id));
        const snaps = await db.getAll(...refs, { fieldMask: ['uid'] });
        for (const s of snaps) if (s.exists) found.add(s.id);
      }
      return found;
    },
    async histories(leadIds) {
      const map = new Map();
      for (const part of chunk(leadIds, 200)) {
        if (!part.length) continue;
        const refs = part.map((id) => db.collection('leads').doc(id));
        const snaps = await db.getAll(...refs, { fieldMask: ['dispositionHistory'] });
        for (const s of snaps) {
          if (!s.exists) continue;
          const h = s.data()?.dispositionHistory;
          if (Array.isArray(h)) map.set(s.id, h.map((e) => ({ userId: e?.userId, disposition: e?.disposition, timestamp: e?.timestamp })));
        }
      }
      return map;
    },
    async eventsOfRun(runId) {
      const snap = await db.collection('fieldKnockEvents').where('backfillRunId', '==', runId).select('source', 'backfillRunId').limit(5000).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
  };
}

export function firestoreWriter({ db, Timestamp, FieldValue }) {
  return {
    async createEvents(batch) {
      const w = db.batch();
      for (const { id, data } of batch) {
        const { actionAtMs, ...rest } = data;
        w.create(db.collection('fieldKnockEvents').doc(id), {
          ...rest,
          actionAt: Timestamp.fromMillis(actionAtMs),
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      await w.commit();
    },
    async deleteEvents(ids) {
      const w = db.batch();
      for (const id of ids) w.delete(db.collection('fieldKnockEvents').doc(id));
      await w.commit();
    },
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv, env);
  const fs = await openFirestore(args.project);
  const out = await execute({
    args,
    reader: firestoreReader(fs),
    makeWriter: () => {
      if (!(args.commit && args.confirmed)) throw new Error('writes are disabled');
      return firestoreWriter(fs);
    },
    log: (line) => console.log(line),
  });
  if (args.summaryOut) await writeFile(args.summaryOut, JSON.stringify(out.summary, null, 2), { mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
