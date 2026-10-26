import { Timestamp, doc, runTransaction } from 'firebase/firestore';
import { auth, db } from '@/app/utils/firebase';
import type { Lead, User } from '@/app/types';
import type { PendingMutation } from './types';
import { mapLeadDoc } from '@/app/utils/firestore';
import { createLeadOnce } from './createLeadOnce';
import { distanceBetween } from 'geofire-common';
import { AREA_REASON_DIRECT_WRITE_SUPPORTED, isGpsUnverifiedReason, validGpsMeters } from './gpsPolicy';
import { deliberateNotesClear, NOTES_MAX_CHARS, NOTES_TOO_LONG_MESSAGE, notesTextOf } from './notesLimits';
import { clearAfterConflict, NOTES_CLEAR_KEPT_NOTICE, planNotesWrite, sameNotes } from './notesRebase';
import { SYNC_REASON } from './syncReasons';
import { gpsFlagOf, type GpsFlag } from '@/app/utils/gpsRule';

/** The history entry stores the true verdict. Top-level out_of_area may be mapped to too_far. */
export function historyGpsFlag(patch: Partial<Lead> | undefined): GpsFlag | undefined {
  if (!patch) return undefined;
  const carried = patch.dispositionHistory?.[0]?.gpsFlag;
  const gpsVerified = carried?.gpsVerified ?? patch.gpsVerified;
  const gpsUnverifiedReason = carried?.gpsUnverifiedReason ?? patch.gpsUnverifiedReason;
  const gpsDistanceM = carried?.gpsDistanceM ?? patch.gpsDistanceM;
  if (gpsVerified == null && gpsUnverifiedReason == null && gpsDistanceM == null) return undefined;
  return gpsFlagOf({
    gpsVerified: gpsVerified === true,
    gpsUnverifiedReason: gpsVerified === true ? undefined : gpsUnverifiedReason,
    gpsDistanceM,
    keepFix: true,
  });
}

export function rejectCombinedKnockAndNotes(patch: Partial<Lead>) {
  const history = patch.dispositionHistory;
  if (typeof patch.notes === "string" && Array.isArray(history) && history.length > 0)
    throw Error("Save the knock and the note as separate actions.");
}

// Bundled mobile releases never depend on the undeployed field APIs.
export const DIRECT_MOBILE_WRITES = process.env.NEXT_PUBLIC_NATIVE_BUILD === '1';
const fields = new Set(['status', 'disposition', 'dispositionedAt', 'dispositionHistory',
  'knockGpsLat', 'knockGpsLng', 'knockGpsAccuracy', 'knockGpsTimestamp', 'knockDistanceFromAddress',
  'gpsVerified', 'gpsUnverifiedReason', 'gpsDistanceM',
  'objectionType', 'objectionNotes', 'objectionRecordedAt', 'objectionRecordedBy',
  'goBackScheduledDate', 'goBackScheduledTime', 'goBackNotes', 'goBackScheduledBy',
  'notes', 'photos', 'name', 'address', 'city', 'state', 'zip', 'phone', 'email', 'estimatedBill']);
const dateFields = ['dispositionedAt', 'knockGpsTimestamp', 'objectionRecordedAt', 'goBackScheduledDate'];
export function dateValue(value: unknown): Date {
  const date = value instanceof Date ? value : value && typeof (value as Timestamp).toDate === 'function'
    ? (value as Timestamp).toDate() : new Date(value as string);
  if (!Number.isFinite(date.getTime())) throw Error('Invalid knock time. Check the device clock.');
  return date;
}
function allowedDirectValue(key: string, value: unknown): boolean {
  if (!fields.has(key) || value === undefined) return false;
  if (key === 'homeownerId' || key === 'gpsPointSource') return false;
  if (key === 'gpsVerified') return typeof value === 'boolean';
  if (key === 'gpsUnverifiedReason') return isGpsUnverifiedReason(value);
  if (key === 'gpsDistanceM' || key === 'knockDistanceFromAddress') return validGpsMeters(value);
  return true;
}
export function directPatch(patch: Partial<Lead>): Partial<Lead> {
  rejectCombinedKnockAndNotes(patch);
  const source = patch as Record<string, unknown>;
  const mapped = source.gpsUnverifiedReason === "out_of_area" && !AREA_REASON_DIRECT_WRITE_SUPPORTED
    ? { ...patch, gpsUnverifiedReason: "too_far" as const }
    : patch;
  return Object.fromEntries(Object.entries(mapped).filter(([k, v]) => allowedDirectValue(k, v)));
}
/** No new server fields/collections. Ownership is never part of an update. */
export function reportingPatch(m: PendingMutation, user: User): Partial<Lead> {
  if (m.userId !== user.id) throw Error('This saved action belongs to a different account.');
  const at = dateValue(m.createdAt);
  let patch = m.direct ? directPatch(m.direct.patch) : m.kind === 'notes' && typeof m.notes === 'string' ? { notes: m.notes } : {};
  if (m.kind === 'contact') {
    const contact = { ...patch };
    delete contact.notes;
    patch = contact;
  }
  if (m.kind === 'handoff') throw Object.assign(Error('Legacy handoff needs review; it was not sent.'), { status: 409 });
  if (m.kind === 'knock') {
    if (!m.status || ['claimed', 'unclaimed'].includes(m.status)) throw Error('Use the claim/unclaim action for ownership changes.');
    const gps = m.observation?.gps;
    const flag = historyGpsFlag(m.direct?.patch);
    patch = { ...patch, status: m.status, dispositionedAt: at,
      dispositionHistory: [{ disposition: m.disposition || m.status, timestamp: at,
        userId: m.userId, userName: m.userName || user.name, ...(flag ? { gpsFlag: flag } : {}) }],
      ...(!m.direct && gps ? { knockGpsLat: gps.lat, knockGpsLng: gps.lng,
        knockGpsAccuracy: gps.accuracy, knockGpsTimestamp: dateValue(gps.timestamp),
        ...(gps.distance != null ? { knockDistanceFromAddress: gps.distance } : {}) } : {}),
      ...(!m.direct && m.objectionType ? { objectionType: m.objectionType as Lead['objectionType'],
        objectionNotes: m.objectionNotes || '', objectionRecordedAt: at, objectionRecordedBy: m.userId } : {}),
      ...(!m.direct && m.goBackScheduledDate ? { disposition: m.disposition || m.status,
        goBackScheduledDate: dateValue(m.goBackScheduledDate), goBackScheduledTime: m.goBackScheduledTime || '',
        goBackNotes: m.goBackNotes || '', goBackScheduledBy: m.userId } : {}),
    };
  }
  for (const key of dateFields) {
    const values = patch as Record<string, unknown>;
    if (values[key] != null) values[key] = dateValue(values[key]);
  }
  return patch;
}
/** Merge against current server history; an uncertain acknowledgement can safely retry.
 * The same uid/time/disposition identifies a replay without adding server schema.
 */
export function mergeReportingPatch(current: Partial<Lead>, patch: Partial<Lead>) {
  const entry = patch.dispositionHistory?.[0];
  if (!entry) return { patch, replayed: false };
  const history = current.dispositionHistory || [];
  const at = dateValue(entry.timestamp).getTime();
  if (history.some(h => h.userId === entry.userId && h.disposition === entry.disposition && dateValue(h.timestamp).getTime() === at))
    return { patch: {}, replayed: true };
  const merged = [entry, ...history].sort((a, b) => dateValue(b.timestamp).getTime() - dateValue(a.timestamp).getTime());
  // A delayed offline knock must not roll a newer disposition/GPS back in time.
  if (current.dispositionedAt && dateValue(current.dispositionedAt).getTime() > at)
    return { patch: { dispositionHistory: merged }, replayed: false };
  return { patch: { ...patch, dispositionHistory: merged }, replayed: false };
}
export function firestoreValue(value: unknown): unknown {
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (value instanceof Timestamp) return value;
  if (Array.isArray(value)) return value.map(firestoreValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== undefined).map(([k, v]) => [k, firestoreValue(v)]));
  return value;
}
export type DirectCommitIo = {
  db: NonNullable<typeof db>;
  auth: NonNullable<typeof auth>;
  doc: typeof doc;
  runTransaction: typeof runTransaction;
  /** IndexedDB write-ahead for an owned notes commit. Runs before the lead update. */
  persistDraft?: (draft: PendingMutation) => Promise<unknown>;
};

async function rememberNotesPlan(draft: PendingMutation, io?: DirectCommitIo): Promise<void> {
  if (io?.persistDraft) {
    await io.persistDraft(draft);
    return;
  }
  if (typeof indexedDB === "undefined") return;
  const { putDraft } = await import("./deviceStore");
  await putDraft(draft);
}

export async function commitDirectMutation(m: PendingMutation, user: User, io?: DirectCommitIo) {
  const database = io?.db ?? db;
  const session = io?.auth ?? auth;
  const docOf = io?.doc ?? doc;
  const transact = io?.runTransaction ?? runTransaction;
  if (!database) throw Error('Firestore is not configured. Your action stays unsynced.');
  const check = () => { if (session?.currentUser?.uid !== m.userId || user.id !== m.userId)
    throw Error('Account changed. Reconnect with the rep who recorded this action.'); };
  check();
  if (m.direct?.gps) throw Object.assign(Error('GPS verification is still pending. Your knock is saved on this phone.'), {status:409});
  const ref = docOf(database, 'leads', m.leadId), patch = reportingPatch(m, user);
  const editedNotes = notesTextOf(m) ?? (typeof patch.notes === 'string' ? patch.notes : undefined);
  if (m.kind === 'notes' && typeof editedNotes === 'string' && !editedNotes.trim() && !deliberateNotesClear(m)) {
    throw Object.assign(Error('Notes were rejected.'), { status: 400, reasonCode: SYNC_REASON.notesRejected });
  }
  try {
    const seed = m.direct?.create;
    if (seed) {
      if (seed.id !== m.leadId || seed.setterId !== m.userId || seed.claimedBy !== m.userId || seed.source !== 'manually-added')
        throw Object.assign(Error('New lead ownership must match the signed-in rep.'), { status: 403 });
      if (await createLeadOnce(m.leadId, m.userId, { ...seed, ...patch })) return { replayed: false, lead: { ...seed, ...patch } as Lead };
    }
    return await transact(database, async tx => {
      check();
      const snapshot = await tx.get(ref);
      check();
      if (!snapshot.exists()) {
        throw Object.assign(Error('This lead is missing. The action remains unsynced for review.'), { status: 404 });
      }
      const current = snapshot.data() as Lead;
      if (m.direct?.legacy && patch.knockGpsLat != null && patch.knockGpsLng != null && current.lat != null && current.lng != null)
        patch.knockDistanceFromAddress = distanceBetween([patch.knockGpsLat, patch.knockGpsLng], [current.lat, current.lng]) * 1000;
      if (current.historicalTerritoryPin) throw Object.assign(Error('Historical pins cannot be dispositioned.'), { status: 403 });
      if (m.kind === 'contact' || (m.kind === 'notes' && typeof patch.notes !== 'string' && typeof m.notes !== 'string')) {
        const contact = { ...patch };
        delete contact.notes;
        const merged = mergeReportingPatch(current, contact);
        if (!merged.replayed) tx.update(ref, firestoreValue(merged.patch) as Record<string, unknown>);
        return { replayed: merged.replayed, lead: mapLeadDoc({ id: m.leadId, data: () => ({ ...current, ...merged.patch }) }) };
      }
      if (m.kind === 'notes') {
        const edited = typeof patch.notes === 'string' ? patch.notes : (m.notes as string);
        if (edited === '' && !deliberateNotesClear(m)) {
          throw Object.assign(Error('Notes were rejected.'), { status: 400, reasonCode: SYNC_REASON.notesRejected });
        }
        if (deliberateNotesClear(m)) {
          const currentNotes = typeof current.notes === 'string' ? current.notes : '';
          const base = m.baseNotes || '';
          const rest = { ...patch };
          delete rest.notes;
          if (currentNotes !== base && currentNotes.trim() !== '') {
            // NOTES-MERGE-SPEC V4: the notes moved under this clear. Keep the lines the server added.
            const kept = clearAfterConflict(m, currentNotes);
            if (kept) {
              const lead = mapLeadDoc({ id: m.leadId, data: () => ({ ...current, ...rest, notes: kept }) });
              const write = { ...rest, ...(sameNotes(kept, currentNotes) ? {} : { notes: kept }) };
              if (Object.keys(write).length) tx.update(ref, firestoreValue(write) as Record<string, unknown>);
              return { replayed: !Object.keys(write).length, lead, notice: NOTES_CLEAR_KEPT_NOTICE };
            }
          }
          const lead = mapLeadDoc({ id: m.leadId, data: () => ({ ...current, ...rest, notes: '' }) });
          if (currentNotes === '' && !Object.keys(rest).length) return { replayed: true, lead };
          const write = { ...rest, ...(currentNotes === '' ? {} : { notes: '' }) };
          tx.update(ref, firestoreValue(write) as Record<string, unknown>);
          return { replayed: false, lead };
        }
        const applied = planNotesWrite({
          currentNotes: current.notes,
          baseNotes: m.baseNotes,
          edited,
          appliedNotes: m.appliedNotes,
          appliedAgainst: m.appliedAgainst,
        });
        if (applied.notes.length > NOTES_MAX_CHARS) {
          throw Object.assign(Error(NOTES_TOO_LONG_MESSAGE), { status: 413, reasonCode: SYNC_REASON.notesTooLong });
        }
        const rest = { ...patch };
        delete rest.notes;
        const lead = mapLeadDoc({ id: m.leadId, data: () => ({ ...current, ...rest, notes: applied.notes }) });
        if ((applied.alreadyApplied || applied.replayed) && !Object.keys(rest).length) return { replayed: true, lead };
        const recorded: PendingMutation = {
          ...m,
          appliedNotes: applied.appliedNotes,
          appliedAgainst: applied.appliedAgainst,
        };
        m.appliedNotes = applied.appliedNotes;
        m.appliedAgainst = applied.appliedAgainst;
        await rememberNotesPlan(recorded, io);
        const write = { ...rest, ...(applied.replayed ? {} : { notes: applied.notes }) };
        tx.update(ref, firestoreValue(write) as Record<string, unknown>);
        return { replayed: false, lead };
      }
      const merged = mergeReportingPatch(current, patch);
      if (!merged.replayed) tx.update(ref, firestoreValue(merged.patch) as Record<string, unknown>);
      return { replayed: merged.replayed, lead: mapLeadDoc({id:m.leadId, data:()=>({...current, ...merged.patch})}) };
    });
  } catch (error) {
    const e = error as Error & { code?: string; status?: number };
    if (e.code === 'permission-denied') e.status = 403;
    throw e;
  }
}
