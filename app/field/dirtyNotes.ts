import {
  NOTES_BLANK_MESSAGE,
  NOTES_TOO_LONG_MESSAGE,
  notesEditTooLong,
  whitespaceNotesChange,
  type NotesLengthDraft,
} from "./notesLimits";

export const NOTES_SAVED_MESSAGE = "Notes saved.";
export const NOTES_SAVED_ON_PHONE_MESSAGE = "Notes saved on this phone. They'll sync when you're online.";

export type DirtyNotesDecision =
  | { kind: "clean" }
  | { kind: "notice"; message: string }
  | { kind: "save"; notes: string };

/**
 * Typed textarea notes that differ from the lead are their own draft.
 * A summary pin, unchanged text, whitespace, or an over-long note does not
 * become a draft. A notice never undoes a knock that already saved.
 */
export function decideDirtyNotes(input: {
  summaryOnly?: boolean;
  currentNotes: string;
  typedNotes: string;
  leadId: string;
  parkedNotes?: NotesLengthDraft[];
}): DirtyNotesDecision {
  if (input.summaryOnly) return { kind: "clean" };
  const current = input.currentNotes || "";
  const typed = input.typedNotes ?? "";
  if (typed === current) return { kind: "clean" };
  if (whitespaceNotesChange(current, typed)) return { kind: "notice", message: NOTES_BLANK_MESSAGE };
  if (notesEditTooLong({
    currentNotes: current,
    notes: typed,
    leadId: input.leadId,
    baseNotes: current,
    parkedNotes: input.parkedNotes,
  })) return { kind: "notice", message: NOTES_TOO_LONG_MESSAGE };
  return { kind: "save", notes: typed };
}
