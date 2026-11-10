/**
 * Pure planner for the fieldKnockEvents backfill. See run.mjs for the CLI.
 *
 * Source: fieldSyncReports with outcome 'refused' and reasonCode 'owned_by_other'
 * from the phone, i.e. knocks that /api/field/dispo refused for a stale owner stamp.
 * Those knocks never reached dispositionHistory, so no counter saw them.
 * Output: create-only fieldKnockEvents/{uid}_{draftId} docs (events ONLY: no lead
 * write, no receipt, no history entry). `at` is the report's actionAt (the draft's
 * original time). Dedupe is the same ledger key the counters use,
 * leadId|userId|dispositionId|atMs, then the 120 s same rep+lead+disposition collapse.
 *
 * The exclusion sets below are a copy of app/utils/knockCount.ts (this script runs
 * under plain node); tests/field-knock-backfill.test.ts pins parity.
 */
import { createHash } from 'node:crypto';

export const KNOCK_REPEAT_MS = 120000;
/** 2026-11-01 00:00 America/Phoenix (UTC-7). */
export const DEFAULT_SINCE_MS = Date.UTC(2026, 10, 1, 7, 0, 0);
export const MAX_REPORTS = 10000;
export const BATCH_SIZE = 100;
export const EXCLUDED_KNOCK_KEYS = new Set(['shade-dq', 'has-solar', 'already-has-solar']);
export const NON_KNOCK_KEYS = new Set([
  '', 'assigned', 'unassigned', 'unclaimed', 'claimed', 'new', 'not-knocked', 'available', 'my-targets',
]);

export function dispositionSlug(raw) {
  return String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '-');
}
export function isCountedKnock(id) {
  const key = dispositionSlug(id);
  return !EXCLUDED_KNOCK_KEYS.has(key) && !NON_KNOCK_KEYS.has(key);
}
export function ledgerKey(leadId, userId, dispositionId, at) {
  return `${leadId}|${userId}|${dispositionId}|${at}`;
}

/** Timestamp-like, Date, ISO string or epoch ms to epoch ms. Null when invalid. */
export function instant(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') return value.toMillis();
    const s = value.seconds ?? value._seconds;
    if (typeof s === 'number') return s * 1000 + Math.floor((value.nanoseconds ?? value._nanoseconds ?? 0) / 1e6);
  }
  return null;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Why a report is not backfilled, or null when it is a candidate. */
export function reportSkipReason(report, sinceMs) {
  if (!report || typeof report !== 'object') return 'malformed';
  if (report.outcome !== 'refused') return 'not_refused';
  if (report.reasonCode !== 'owned_by_other') return 'other_reason';
  const at = instant(report.actionAt);
  if (at == null || !ID.test(String(report.uid ?? '')) || !ID.test(String(report.draftId ?? '')) || !ID.test(String(report.leadId ?? ''))) {
    return 'malformed';
  }
  if (at < sinceMs) return 'before_since';
  const dispo = dispositionSlug(report.intendedStatus);
  if (!dispo || NON_KNOCK_KEYS.has(dispo)) return 'not_a_knock';
  if (EXCLUDED_KNOCK_KEYS.has(dispo)) return 'excluded_disposition';
  return null;
}

function title(slug) {
  return slug.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/**
 * @param input.reports        fieldSyncReports rows ({id, ...fields})
 * @param input.existingEvents Set of fieldKnockEvents doc ids that already exist
 * @param input.receipts       Set of fieldDispoReceipts doc ids that already exist (draft was handled live)
 * @param input.historyByLead  Map leadId -> [{userId, disposition, timestamp}] (dispositionHistory)
 */
export function buildPlan(input) {
  const sinceMs = input.sinceMs ?? DEFAULT_SINCE_MS;
  const skipped = {};
  const bump = (reason) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  const candidates = [];
  const seenIds = new Set();
  for (const report of input.reports) {
    const reason = reportSkipReason(report, sinceMs);
    if (reason) { bump(reason); continue; }
    const id = `${report.uid}_${report.draftId}`;
    if (seenIds.has(id)) { bump('duplicate_report'); continue; }
    seenIds.add(id);
    if (input.existingEvents?.has(id)) { bump('event_exists'); continue; }
    if (input.receipts?.has(id)) { bump('receipt_exists'); continue; }
    const at = instant(report.actionAt);
    const dispositionId = dispositionSlug(report.intendedStatus);
    const key = ledgerKey(report.leadId, report.uid, dispositionId, at);
    const history = input.historyByLead?.get(report.leadId) ?? [];
    let inHistory = false;
    let nearHistory = false;
    for (const entry of history) {
      if (!entry || entry.userId !== report.uid) continue;
      if (dispositionSlug(entry.disposition) !== dispositionId) continue;
      const t = instant(entry.timestamp);
      if (t == null) continue;
      if (t === at) inHistory = true;
      else if (Math.abs(t - at) <= KNOCK_REPEAT_MS) nearHistory = true;
    }
    if (inHistory) { bump('already_in_history'); continue; }
    if (nearHistory) { bump('collapsed_into_history'); continue; }
    candidates.push({ id, key, report, at, dispositionId });
  }
  // 120 s collapse among the new events: same rep+lead+disposition, kept only when > 120 s after the last kept.
  candidates.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  const lastKept = new Map();
  const creates = [];
  for (const c of candidates) {
    const group = `${c.report.leadId}|${c.report.uid}|${c.dispositionId}`;
    const last = lastKept.get(group);
    if (last != null && c.at - last <= KNOCK_REPEAT_MS) { bump('collapsed_repeat'); continue; }
    lastKept.set(group, c.at);
    creates.push(c);
  }
  creates.sort((a, b) => (a.id < b.id ? -1 : 1));
  const planHash = createHash('sha256')
    .update(JSON.stringify({ sinceMs, rows: creates.map((c) => [c.id, c.key]) }))
    .digest('hex');
  const runId = `bf-${planHash.slice(0, 12)}`;
  const perRep = {};
  for (const c of creates) {
    const row = (perRep[c.report.uid] ??= { name: String(c.report.userName ?? '').slice(0, 80) || null, events: 0, byDisposition: {} });
    row.events += 1;
    row.byDisposition[c.dispositionId] = (row.byDisposition[c.dispositionId] ?? 0) + 1;
  }
  return {
    sinceMs,
    planHash,
    runId,
    total: creates.length,
    skipped,
    perRep,
    docs: creates.map((c) => ({ id: c.id, data: eventData(c, runId) })),
  };
}

/** Same field set as the live counts-only write (fieldDispo.applyCountedOnly), with source:'backfill'. */
export function eventData(c, runId) {
  const r = c.report;
  return {
    uid: r.uid,
    userName: typeof r.userName === 'string' ? r.userName.slice(0, 80) : '',
    draftId: r.draftId,
    leadId: r.leadId,
    collection: 'leads',
    disposition: title(c.dispositionId),
    dispositionId: c.dispositionId,
    status: dispositionSlug(r.intendedStatus),
    actionAtMs: c.at,
    reason: 'owned_by_other',
    effectiveOwnerId: null,
    effectiveOwnerIds: [],
    ownerSource: 'backfill',
    source: 'backfill',
    backfillRunId: runId,
    reportId: r.id ?? `${r.uid}_${r.draftId}`,
  };
}

export function parseArgs(argv, env = {}) {
  const out = { commit: false, undo: null, planHash: null, sinceMs: DEFAULT_SINCE_MS, project: null, summaryOut: null, errors: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--commit') out.commit = true;
    else if (a === '--undo') out.undo = val();
    else if (a === '--plan-hash') out.planHash = val();
    else if (a === '--project') out.project = val();
    else if (a === '--summary-out') out.summaryOut = val();
    else if (a === '--since') {
      const t = Date.parse(val());
      if (Number.isFinite(t)) out.sinceMs = t; else out.errors.push('bad --since');
    } else out.errors.push(`unknown argument ${a}`);
  }
  if (out.undo && !/^bf-[0-9a-f]{12}$/.test(out.undo)) out.errors.push('--undo needs a run id like bf-0123456789ab');
  out.confirmed = env.FIELD_KNOCK_BACKFILL_CONFIRM === 'yes';
  if (out.commit && !out.confirmed) out.errors.push('--commit also needs FIELD_KNOCK_BACKFILL_CONFIRM=yes');
  if (out.commit && !out.undo && !/^[0-9a-f]{64}$/.test(out.planHash ?? '')) out.errors.push('--commit needs --plan-hash <full hash from a dry run>');
  return out;
}

export function chunk(list, size = BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** What a dry run prints: counts only, no leads, no addresses. */
export function summarize(plan) {
  return {
    mode: 'dry-run',
    runId: plan.runId,
    planHash: plan.planHash,
    since: new Date(plan.sinceMs).toISOString(),
    wouldCreate: plan.total,
    skipped: plan.skipped,
    perRep: Object.entries(plan.perRep)
      .map(([uid, v]) => ({ uid, name: v.name, events: v.events, byDisposition: v.byDisposition }))
      .sort((a, b) => b.events - a.events),
  };
}
