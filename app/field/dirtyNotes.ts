import {
  NOTES_BLANK_MESSAGE,
  NOTES_TOO_LONG_MESSAGE,
  notesEditTooLong,
  whitespaceNotesChange,
  type NotesLengthDraft,
} from "./notesLimits";

export const NOTES_SAVED_MESSAGE = "Notes saved.";
export const NOTES_SAVED_ON_PHONE_MESSAGE = "Notes saved on this phone. They'll sync when you're online.";
export const NOTES_SAVED_TOAST_MS = 4_000;

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

export type CloseNotesInput = {
  summaryOnly?: boolean;
  currentNotes: string;
  typedNotes: string;
  leadId: string;
  /** Text already queued by this panel. A later close or unmount must not queue it again. */
  flushedNotes: string | null;
  parkedNotes?: NotesLengthDraft[];
};

export type CloseNotesPlan =
  | { action: "close"; queued: false; flushedNotes: string | null }
  | { action: "close"; queued: true; notes: string; flushedNotes: string; message: string }
  | { action: "stay"; notice: string; flushedNotes: string | null };

function alreadyFlushed(input: CloseNotesInput): boolean {
  return input.flushedNotes != null && input.flushedNotes === (input.typedNotes ?? "");
}

/** X, Back, and a disposition close. A notice keeps the panel open and queues nothing. */
export function planCloseWithNotes(input: CloseNotesInput): CloseNotesPlan {
  if (alreadyFlushed(input)) return { action: "close", queued: false, flushedNotes: input.flushedNotes };
  const decision = decideDirtyNotes(input);
  if (decision.kind === "notice") return { action: "stay", notice: decision.message, flushedNotes: input.flushedNotes };
  if (decision.kind === "clean") return { action: "close", queued: false, flushedNotes: input.flushedNotes };
  return {
    action: "close",
    queued: true,
    notes: decision.notes,
    flushedNotes: decision.notes,
    message: NOTES_SAVED_ON_PHONE_MESSAGE,
  };
}

/** Parent unmount or a key change. Null means the draft was already queued, or the text is not a note. */
export function planUnmountNotesFlush(input: CloseNotesInput): { notes: string; flushedNotes: string } | null {
  if (alreadyFlushed(input)) return null;
  const decision = decideDirtyNotes(input);
  if (decision.kind !== "save") return null;
  return { notes: decision.notes, flushedNotes: decision.notes };
}
