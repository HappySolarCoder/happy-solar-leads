import type { Lead } from "@/app/types";
import { freshDraftId } from "./draftQueue";
import type { NotesLengthDraft } from "./notesLimits";
import { NOTES_TOO_LONG_MESSAGE, notesEditTooLong, notesQueuedBody } from "./notesLimits";
import type { PendingMutation } from "./types";

/** Same shape as the disposition route's draft id. Contact drafts are never sent there. */
const DRAFT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * A notes edit is a notes string on the patch that differs from the server base.
 * A 14.18 carrier sets mutation.notes to "" and leaves notes off the patch.
 * That is not an edit.
 */
export function notesWereEdited(m: Pick<PendingMutation, "baseNotes" | "direct" | "notes">): boolean {
  const patch = m.direct?.patch;
  if (!patch || typeof patch.notes !== "string") return false;
  return patch.notes !== (m.baseNotes || "");
}

export function contactFieldKeys(patch: Partial<Lead> | undefined): string[] {
  if (!patch) return [];
  return Object.keys(patch).filter((key) => key !== "notes");
}

export function hasContactFields(m: Pick<PendingMutation, "direct">): boolean {
  return contactFieldKeys(m.direct?.patch).length > 0;
}

/** Notes stay off the contact patch. Unchanged notes are not a notes edit. */
export function partitionLeadPatch(lead: Pick<Lead, "notes">, patch: Partial<Lead>): {
  contact: Partial<Lead> | null;
  notes: string | null;
} {
  const contact: Partial<Lead> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "notes" || value === undefined) continue;
    (contact as Record<string, unknown>)[key] = value;
  }
  const notes = typeof patch.notes === "string" && patch.notes !== (lead.notes || "") ? patch.notes : null;
  return { contact: Object.keys(contact).length ? contact : null, notes };
}

function withoutNotes(patch: Partial<Lead>): Partial<Lead> {
  const next = { ...patch };
  delete next.notes;
  return next;
}

/** Contact and photo drafts never carry notes, baseNotes, or a route flag. */
export function asContactDraft(m: PendingMutation): PendingMutation {
  const patch = withoutNotes(m.direct?.patch || {});
  const direct = { ...(m.direct || { patch }), patch };
  delete direct.serverDispo;
  const next: PendingMutation = { ...m, kind: "contact", direct };
  delete next.notes;
  delete next.baseNotes;
  delete next.clearNotes;
  return next;
}

/**
 * Replay a 14.18 queue row `{kind:'notes', notes:'', patch:{non-notes}}` as the
 * contact patch only. A real notes edit, including a deliberate clear, stays notes.
 * This does not set clearNotes. An unflagged blank note is not a clear.
 */
export function coerceLegacyContactDraft(m: PendingMutation): PendingMutation {
  if (m.collection === "hotLeads" || m.kind === "claim") return m;
  if (m.kind !== "notes") return m;
  if (notesWereEdited(m)) return m;
  if (!hasContactFields(m)) return m;
  return asContactDraft(m);
}

export function splitNotesAndContact(
  m: PendingMutation,
  existingIds: ReadonlySet<string>,
): { contact: PendingMutation; notes: PendingMutation } | "unsafe" | null {
  if (m.collection === "hotLeads" || m.kind === "claim") return null;
  if (m.kind !== "notes" || !notesWereEdited(m) || !hasContactFields(m) || !m.direct?.patch) return null;
  // The combined row has not been posted. The notes part keeps that id so the
  // receipt is not burned by the contact part. The contact part always gets its own id.
  const notesId = DRAFT_ID_PATTERN.test(m.id) ? m.id : freshDraftId(m.id, "notes", existingIds);
  const contactId = freshDraftId(m.id, "contact", existingIds);
  if (
    !DRAFT_ID_PATTERN.test(contactId)
    || !DRAFT_ID_PATTERN.test(notesId)
    || contactId === notesId
    || (notesId !== m.id && existingIds.has(notesId))
    || existingIds.has(contactId)
  ) return "unsafe";
  const notes = m.direct.patch.notes as string;
  const contact: PendingMutation = asContactDraft({
    ...m,
    id: contactId,
    direct: { ...m.direct, patch: withoutNotes(m.direct.patch) },
  });
  const noteDraft: PendingMutation = {
    ...m,
    id: notesId,
    kind: "notes",
    notes,
    direct: { ...m.direct, patch: { notes } },
  };
  if (notes === "" && m.clearNotes === true) noteDraft.clearNotes = true;
  else delete noteDraft.clearNotes;
  delete noteDraft.status;
  delete noteDraft.disposition;
  return { contact, notes: noteDraft };
}

export function buildLeadSaveDrafts(input: {
  lead: Lead;
  patch: Partial<Lead>;
  actor: { id: string; name: string; role?: string };
  createdAt: string;
  ids?: { contact?: string; notes?: string };
  parkedNotes?: NotesLengthDraft[];
  create?: Lead;
  useRoute?: (notes: string) => boolean;
}): { drafts: PendingMutation[]; notesTooLong: boolean } {
  const parts = partitionLeadPatch(input.lead, input.patch);
  const drafts: PendingMutation[] = [];
  const contactId = input.ids?.contact || "contact";
  if (parts.contact) {
    const draft: PendingMutation = {
      id: contactId,
      userId: input.actor.id,
      userName: input.actor.name,
      leadId: input.lead.id,
      createdAt: input.createdAt,
      kind: "contact",
      baseStatus: input.lead.status,
      direct: {
        patch: parts.contact,
        ...(input.create && parts.notes == null ? { create: input.create } : {}),
      },
    };
    drafts.push(draft);
  }
  if (parts.notes == null) return { drafts, notesTooLong: false };
  // Whitespace is not a clear and is not a note. It never becomes a draft.
  if (parts.notes !== "" && !parts.notes.trim()) return { drafts, notesTooLong: false };
  const notesId = input.ids?.notes || "notes";
  const baseNotes = input.lead.notes || "";
  const priors = input.parkedNotes || [];
  if (notesEditTooLong({
    currentNotes: baseNotes,
    notes: parts.notes,
    leadId: input.lead.id,
    baseNotes,
    draftId: notesId,
    actionAt: input.createdAt,
    parkedNotes: priors,
  })) return { drafts, notesTooLong: true };
  const queued = notesQueuedBody({
    leadId: input.lead.id,
    notes: parts.notes,
    baseNotes,
    draftId: notesId,
    actionAt: input.createdAt,
    parkedNotes: priors,
  });
  if (queued.tooLong) return { drafts, notesTooLong: true };
  if (queued.notes !== "" && !queued.notes.trim()) return { drafts, notesTooLong: false };
  const clearing = queued.notes === "";
  const route = input.useRoute?.(queued.notes) === true;
  drafts.push({
    id: notesId,
    userId: input.actor.id,
    userName: input.actor.name,
    leadId: input.lead.id,
    createdAt: input.createdAt,
    kind: "notes",
    baseStatus: input.lead.status,
    baseNotes: queued.baseNotes,
    notes: queued.notes,
    ...(clearing ? { clearNotes: true } : {}),
    direct: {
      patch: { notes: queued.notes },
      ...(route ? { serverDispo: true } : {}),
      ...(input.create && !parts.contact ? { create: input.create } : {}),
    },
  });
  return { drafts, notesTooLong: false };
}

export { NOTES_TOO_LONG_MESSAGE };
