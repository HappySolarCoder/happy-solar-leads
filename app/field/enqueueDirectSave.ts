import type { Lead } from "@/app/types";
import { buildLeadSaveDrafts } from "./contactSave";
import { NOTES_TOO_LONG_MESSAGE, type NotesLengthDraft } from "./notesLimits";
import { notesDraftUsesRoute } from "./serverDispo";
import type { PendingMutation } from "./types";

/**
 * The non-knock save used by useFieldData.enqueueDirect.
 * Contact fields and notes are separate drafts. A contact draft never carries notes.
 */
export async function enqueueDirectSave(input: {
  lead: Lead;
  patch: Partial<Lead>;
  actor: { id: string; name: string; role?: string };
  create?: Lead;
  createdAt: string;
  ids?: { contact: string; notes: string };
  parkedNotes?: NotesLengthDraft[];
  enqueue: (draft: PendingMutation) => Promise<void>;
}): Promise<void> {
  const built = buildLeadSaveDrafts({
    lead: input.lead,
    patch: input.patch,
    actor: input.actor,
    createdAt: input.createdAt,
    ids: input.ids || { contact: crypto.randomUUID(), notes: crypto.randomUUID() },
    parkedNotes: input.parkedNotes,
    create: input.create,
    useRoute: (notes) => notesDraftUsesRoute(input.lead, input.actor.id, input.actor.role, notes),
  });
  for (const draft of built.drafts) await input.enqueue(draft);
  if (built.notesTooLong) throw Error(NOTES_TOO_LONG_MESSAGE);
}
