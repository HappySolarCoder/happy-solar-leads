import { splitNotesAndContact } from "./contactSave";
import { effectiveSyncState } from "./draftState";
import { compareNotesSend, notesLineageNewer } from "./notesCoalesce";
import { splitCombinedDraft } from "./serverDispo";
import type { FieldMutation, PendingMutation } from "./types";

/**
 * Queue order. createdAt wins when it differs, so a draft saved before sequences
 * existed stays in time order. Same-millisecond drafts use queueSeq. A missing
 * sequence is not zero: it sorts by createdAt, then id.
 */
export function compareQueuedDrafts(
  a: { createdAt?: string; id?: string; queueSeq?: number },
  b: { createdAt?: string; id?: string; queueSeq?: number },
): number {
  const byTime = (a.createdAt || "").localeCompare(b.createdAt || "");
  if (byTime !== 0) return byTime;
  const aSeq = typeof a.queueSeq === "number" && Number.isFinite(a.queueSeq);
  const bSeq = typeof b.queueSeq === "number" && Number.isFinite(b.queueSeq);
  if (aSeq && bSeq && a.queueSeq !== b.queueSeq) return (a.queueSeq as number) - (b.queueSeq as number);
  if (aSeq !== bSeq) return aSeq ? 1 : -1;
  return (a.id || "").localeCompare(b.id || "");
}

const queueSeqFloor = new Map<string, number>();

/** Tests that assert the first sequence start from an empty counter. */
export function resetQueueSeqForTests(): void {
  queueSeqFloor.clear();
}

/**
 * Next device sequence for this account. Pass only that account's drafts.
 * The counter increments synchronously, so two saves in one turn that both
 * see the same snapshot still get distinct sequences.
 */
export function nextQueueSeq(existing: readonly { queueSeq?: number }[], userId = ""): number {
  let max = 0;
  for (const row of existing) {
    if (typeof row.queueSeq === "number" && Number.isFinite(row.queueSeq) && row.queueSeq > max) max = row.queueSeq;
  }
  const seq = Math.max(max, queueSeqFloor.get(userId) ?? 0) + 1;
  queueSeqFloor.set(userId, seq);
  return seq;
}

function notesText(row: Pick<PendingMutation, "notes" | "direct">): string {
  if (typeof row.notes === "string") return row.notes;
  const patchNotes = row.direct?.patch?.notes;
  return typeof patchNotes === "string" ? patchNotes : "";
}

const DRAFT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** A receipt key is uid+draftId and has no TTL. A reused id is a silent no-op. */
export function mintDraftId(existing: readonly { id?: string }[]): string {
  const taken = new Set(existing.map((row) => row.id).filter((id): id is string => !!id));
  let id = crypto.randomUUID();
  while (taken.has(id) || !DRAFT_ID_PATTERN.test(id)) id = crypto.randomUUID();
  return id;
}

export function freshDraftId(base: string, suffix: string, existing: ReadonlySet<string>): string {
  const preferred = `${base}-${suffix}`;
  if (DRAFT_ID_PATTERN.test(preferred) && !existing.has(preferred)) return preferred;
  return mintDraftId([...existing].map((id) => ({ id })));
}

const KNOWN_SENT_CAP = 10;

/** Queued or retrying. A parked note is not replaced; the next save absorbs it. */
export function isUnsentNotesDraft(row: PendingMutation): boolean {
  if (row.kind !== "notes" || row.direct?.gps) return false;
  const state = effectiveSyncState(row);
  return state !== "parked" && state !== "gps";
}

function rememberSent(prior: PendingMutation): string[] {
  const list = [...(prior.knownSentNotes || [])];
  const text = notesText(prior);
  if (!list.includes(text)) list.push(text);
  return list.slice(-KNOWN_SENT_CAP);
}

function capKnown(texts: readonly string[]): string[] {
  const list: string[] = [];
  for (const text of texts) {
    if (!list.includes(text)) list.push(text);
  }
  return list.slice(-KNOWN_SENT_CAP);
}

/**
 * 14.18 and early 14.19 drafts never stored knownSentNotes. The text may
 * already be on the server. Remember it so a later 409 does not append it again.
 */
function seedLegacyKnown(row: PendingMutation): PendingMutation {
  if (row.knownSentNotes) return row;
  return { ...row, knownSentNotes: capKnown([notesText(row)]) };
}

/** Keep each line once, in the order the texts were written. */
export function keepBothOnce(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  if (left === right) return left;
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of `${left}\n${right}`.split("\n")) {
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines.join("\n");
}

function oldestNotes(rows: readonly PendingMutation[]): PendingMutation {
  return rows.slice().sort((a, b) => {
    const byTime = (a.createdAt || "").localeCompare(b.createdAt || "");
    if (byTime !== 0) return byTime;
    return (a.id || "").localeCompare(b.id || "");
  })[0];
}

/**
 * A single chain uses the newest text. A cycle or a fork keeps every text once.
 */
function lineageNotes(rows: readonly PendingMutation[]): { notes: string; ambiguous: boolean } {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const row of rows) {
    incoming.set(row.id, 0);
    outgoing.set(row.id, []);
  }
  for (const older of rows) {
    for (const newer of rows) {
      if (older.id === newer.id || !notesLineageNewer(older, newer)) continue;
      outgoing.get(older.id)?.push(newer.id);
      incoming.set(newer.id, (incoming.get(newer.id) || 0) + 1);
    }
  }
  const queue = rows.map((row) => row.id).filter((id) => incoming.get(id) === 0);
  const order: string[] = [];
  const degree = new Map(incoming);
  let ambiguous = false;
  while (queue.length) {
    if (queue.length > 1) ambiguous = true;
    const id = queue.shift() as string;
    order.push(id);
    for (const next of outgoing.get(id) || []) {
      const left = (degree.get(next) || 1) - 1;
      degree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  if (order.length !== rows.length) ambiguous = true;
  if (!ambiguous && order.length > 1) {
    const reach = new Map<string, Set<string>>();
    for (const id of [...order].reverse()) {
      const seen = new Set<string>();
      for (const next of outgoing.get(id) || []) {
        seen.add(next);
        for (const item of reach.get(next) || []) seen.add(item);
      }
      reach.set(id, seen);
    }
    for (let i = 0; i < order.length; i += 1) {
      for (let j = i + 1; j < order.length; j += 1) {
        if (!reach.get(order[i])?.has(order[j])) ambiguous = true;
      }
    }
  }
  if (ambiguous || !order.length) {
    const notes = rows
      .slice()
      .sort(compareNotesSend)
      .reduce((text, row) => keepBothOnce(text, notesText(row)), "");
    return { notes, ambiguous: true };
  }
  return { notes: notesText(byId.get(order[order.length - 1]) as PendingMutation), ambiguous: false };
}

/** One notes draft from several legacy rows. Oldest base, newest lineage text. */
export function collapseNotesGroup(rows: readonly PendingMutation[]): PendingMutation {
  const root = oldestNotes(rows);
  const { notes } = lineageNotes(rows);
  const known = capKnown([
    ...rows.flatMap((row) => row.knownSentNotes || []),
    ...rows.map((row) => notesText(row)),
  ]);
  const clearing = notes === "" && rows.some((row) => row.clearNotes === true && notesText(row) === "");
  const serverDispo = rows.some((row) => row.direct?.serverDispo === true);
  const collapsed: PendingMutation = {
    ...root,
    id: mintDraftId(rows),
    notes,
    baseNotes: root.baseNotes,
    createdAt: root.createdAt,
    knownSentNotes: known,
    syncState: "queued",
    attempts: 0,
    direct: {
      ...(root.direct || { patch: { notes } }),
      patch: { notes },
      ...(serverDispo ? { serverDispo: true } : {}),
    },
  };
  if (typeof root.queueSeq !== "number") delete collapsed.queueSeq;
  else collapsed.queueSeq = root.queueSeq;
  delete collapsed.nextAttemptAt;
  delete collapsed.lastError;
  delete collapsed.routeHold;
  delete collapsed.parkedReason;
  delete collapsed.appliedNotes;
  delete collapsed.appliedAgainst;
  delete collapsed.blocked;
  delete collapsed.error;
  delete collapsed.status;
  delete collapsed.disposition;
  if (clearing) collapsed.clearNotes = true;
  else delete collapsed.clearNotes;
  return collapsed;
}

/**
 * A new notes save replaces the unsent notes draft for that lead and account.
 * The original baseNotes and actionAt stay. The id is new, because the old
 * one may already have been received.
 */
export function foldNotesSave(existing: readonly PendingMutation[], next: PendingMutation): PendingMutation {
  if (next.kind !== "notes") return next;
  const priors = existing.filter((row) =>
    isUnsentNotesDraft(row)
    && row.leadId === next.leadId
    && row.userId === next.userId
    && row.id !== next.id
  );
  if (!priors.length) return next;
  const prior = priors.length === 1 ? priors[0] : collapseNotesGroup(priors);
  const notes = notesText(next);
  const clearing = next.clearNotes === true && notes === "";
  const serverDispo = next.direct?.serverDispo === true || prior.direct?.serverDispo === true;
  const folded: PendingMutation = {
    ...prior,
    id: mintDraftId([...existing, next]),
    notes,
    baseNotes: prior.baseNotes,
    createdAt: prior.createdAt,
    knownSentNotes: rememberSent(prior),
    syncState: "queued",
    attempts: 0,
    userName: next.userName || prior.userName,
    direct: {
      ...(prior.direct || { patch: { notes } }),
      patch: { notes },
      ...(serverDispo ? { serverDispo: true } : {}),
    },
  };
  if (typeof prior.queueSeq !== "number") delete folded.queueSeq;
  else folded.queueSeq = prior.queueSeq;
  delete folded.nextAttemptAt;
  delete folded.lastError;
  delete folded.routeHold;
  delete folded.parkedReason;
  delete folded.appliedNotes;
  delete folded.appliedAgainst;
  delete folded.blocked;
  delete folded.error;
  if (clearing) folded.clearNotes = true;
  else delete folded.clearNotes;
  return folded;
}

/** Ids of unsent notes drafts that foldNotesSave replaced. The caller deletes them. */
export function supersededNotesIds(existing: readonly PendingMutation[], stored: PendingMutation): string[] {
  if (stored.kind !== "notes") return [];
  return existing
    .filter((row) =>
      isUnsentNotesDraft(row)
      && row.leadId === stored.leadId
      && row.userId === stored.userId
      && row.id !== stored.id
    )
    .map((row) => row.id);
}

/**
 * Startup pass. Split contact off notes drafts, then one unsent notes draft
 * per lead and account. A second call is a no-op.
 */
export function collapseLegacyNotesQueue(drafts: readonly PendingMutation[]): PendingMutation[] {
  const ids = new Set(drafts.map((row) => row.id));
  const pieces: PendingMutation[] = [];
  let structural = false;
  for (const row of drafts) {
    if (row.kind === "notes") {
      const contact = splitNotesAndContactSafe(row, ids);
      if (contact) {
        structural = true;
        ids.add(contact.contact.id);
        ids.add(contact.notes.id);
        pieces.push(contact.contact, contact.notes);
        continue;
      }
    }
    if (row.kind === "knock") {
      const split = splitKnockNotesSafe(row, ids);
      if (split) {
        structural = true;
        ids.add(split.knock.id);
        ids.add(split.notes.id);
        pieces.push(split.knock, split.notes);
        continue;
      }
    }
    pieces.push(row);
  }
  const groups = new Map<string, PendingMutation[]>();
  const rest: PendingMutation[] = [];
  for (const row of pieces) {
    if (isUnsentNotesDraft(row)) {
      const key = `${row.userId}\n${row.leadId}`;
      const list = groups.get(key) || [];
      list.push(row);
      groups.set(key, list);
    } else rest.push(row);
  }
  const notes: PendingMutation[] = [];
  for (const list of groups.values()) {
    if (list.length === 1) {
      const seeded = seedLegacyKnown(list[0]);
      if (seeded !== list[0]) structural = true;
      notes.push(seeded);
    } else {
      structural = true;
      notes.push(collapseNotesGroup(list));
    }
  }
  if (!structural) return drafts as PendingMutation[];
  return [...rest, ...notes];
}

function splitNotesAndContactSafe(
  row: PendingMutation,
  ids: Set<string>,
): { contact: PendingMutation; notes: PendingMutation } | null {
  const split = splitNotesAndContact(row, ids);
  return split && split !== "unsafe" ? split : null;
}

function splitKnockNotesSafe(
  row: PendingMutation,
  ids: Set<string>,
): { knock: PendingMutation; notes: PendingMutation } | null {
  const split = splitCombinedDraft(row, ids);
  return split && split !== "unsafe" ? split : null;
}

/** A new dispo joins the queue. A second unsent note for the same lead replaces the first. */
export function acceptDisposition(
  existing: PendingMutation[],
  next: FieldMutation,
): PendingMutation {
  if (existing.length >= 500) {
    console.warn(
      "You have 500 pending changes. Sync or review them before adding more.",
    );
    throw Error(
      "You have 500 pending changes. Sync or review them before adding more.",
    );
  }
  const pending = next as PendingMutation;
  const alreadyQueued = typeof pending.queueSeq === "number" && Number.isFinite(pending.queueSeq);
  const queued: PendingMutation = {
    ...pending,
    queueSeq: alreadyQueued ? pending.queueSeq : nextQueueSeq(existing, pending.userId),
    syncState: pending.syncState ?? (pending.direct?.gps ? "gps" : "queued"),
    attempts: pending.attempts ?? 0,
  };
  if (alreadyQueued) return queued;
  const id = existing.some((row) => row.id === queued.id) ? mintDraftId(existing) : queued.id;
  return foldNotesSave(existing, id === queued.id ? queued : { ...queued, id });
}
