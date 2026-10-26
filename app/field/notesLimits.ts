/**
 * Limits for POST /api/field/dispo.
 * Size limits follow PR #170 at 2063c6c8e46cb13721dd4aa7f0dfe65f456d8afb.
 * The notes contract follows main 15efe05 (PR #175). Requires #175 deployed.
 * A missing notes key means no notes change. clearNotes:true is sent only with
 * notes:"" and baseNotes, and only for a deliberate clear. The flag is never
 * stripped and a clear is never resent without it.
 * kind:notes accepts notes and baseNotes up to NOTES_MAX_CHARS and a JSON body
 * up to NOTES_ROUTE_BODY_MAX_BYTES. A 413 body carries reasonCode
 * payload_too_large. The byte check is the body that is sent. Knock bodies
 * stay at KNOCK_ROUTE_BODY_MAX_BYTES.
 * #171 rules still cap a non-owner direct notes write at NON_OWNER_DIRECT_NOTES_MAX_CHARS,
 * so a longer note on a lead this rep does not own uses the route.
 */
import { rebaseNotes } from "./notesRebase";

export const NOTES_MAX_CHARS = 100_000;
export const NOTES_ROUTE_BODY_MAX_BYTES = 262_144;
export const KNOCK_ROUTE_BODY_MAX_BYTES = 32_768;
export const NON_OWNER_DIRECT_NOTES_MAX_CHARS = 10_000;
export const NOTES_TOO_LONG_MESSAGE = "Notes too long";

/** Same length as crypto.randomUUID() and Date.toISOString(), both ASCII. */
export const NOTES_DRAFT_ID_PLACEHOLDER = "00000000-0000-4000-8000-000000000000";
export const NOTES_ACTION_AT_PLACEHOLDER = "2026-10-26T12:00:00.000Z";

export function notesTextTooLong(text: string): boolean {
  return text.length > NOTES_MAX_CHARS;
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Same key order fieldDispoBody uses for kind:notes. JSON.stringify of this is the sent body. */
export function notesRouteBody(input: {
  leadId: string;
  draftId: string;
  actionAt: string;
  notes: string;
  baseNotes: string | null;
  /** Included only when true, and only together with notes:"". Route reference 15efe05. */
  clearNotes?: boolean;
}) {
  const body = {
    leadId: input.leadId,
    draftId: input.draftId,
    kind: "notes" as const,
    actionAt: input.actionAt,
    notes: input.notes,
    baseNotes: input.baseNotes,
  };
  if (input.clearNotes !== true) return body;
  return { ...body, clearNotes: true as const };
}

export function notesTextOf(m: {
  notes?: string;
  direct?: { patch?: { notes?: unknown } };
}): string | undefined {
  if (typeof m.notes === "string") return m.notes;
  const patchNotes = m.direct?.patch?.notes;
  if (typeof patchNotes === "string") return patchNotes;
  return undefined;
}

/**
 * The rep emptied the notes they last saw. Whitespace is not a clear.
 * clearNotes on the draft is kept once set. A non-empty baseNotes is the
 * text they saw when the flag has not been stored yet.
 */
export function deliberateNotesClear(m: {
  notes?: string;
  baseNotes?: string;
  clearNotes?: boolean;
  direct?: { patch?: { notes?: unknown } };
}): boolean {
  if (notesTextOf(m) !== "") return false;
  if (m.clearNotes === true) return true;
  return typeof m.baseNotes === "string" && m.baseNotes !== "";
}

export function notesRouteBodyBytes(input: {
  leadId: string;
  draftId: string;
  actionAt: string;
  notes: string;
  baseNotes: string | null;
  clearNotes?: boolean;
}): number {
  const clearNotes = input.clearNotes === true
    || (input.notes === "" && (input.baseNotes ?? "") !== "");
  return utf8Bytes(JSON.stringify(notesRouteBody({ ...input, clearNotes })));
}

export type NotesDraftText = { notes: string; baseNotes: string };

/**
 * A later notes edit absorbs one parked or waiting notes_too_long draft.
 * The edit replaces the parked text only when next.baseNotes is that parked
 * text, which means the rep opened it and changed or cleared it. An empty or
 * whitespace edit does not replace it otherwise. A short note that merely
 * happens to be a substring does not replace it either. Anything else rebases
 * onto the parked text so that text is kept.
 */
export function absorbNotesText(parked: NotesDraftText, next: NotesDraftText): NotesDraftText {
  const parkedText = parked.notes || "";
  const nextText = next.notes || "";
  const descended = parkedText !== "" && next.baseNotes === parked.notes;
  if (!nextText.trim()) {
    if (descended) return { notes: nextText, baseNotes: parked.baseNotes || "" };
    return { notes: parkedText, baseNotes: parked.baseNotes || "" };
  }
  if (descended) return { notes: nextText, baseNotes: parked.baseNotes || "" };
  return rebaseNotes(parked.baseNotes || "", nextText, parkedText);
}

export type NotesLengthDraft = {
  id?: string;
  leadId: string;
  kind?: string;
  notes?: string;
  baseNotes?: string;
  parkedReason?: string;
  createdAt?: string;
};

/** The notes body enqueue would send, after absorbing a notes_too_long row on this lead. */
export function notesQueuedBody(input: {
  leadId: string;
  notes: string;
  baseNotes: string | null;
  draftId?: string;
  actionAt?: string;
  parkedNotes?: NotesLengthDraft[];
}): { notes: string; baseNotes: string; tooLong: boolean; bytes: number } {
  const priors = (input.parkedNotes || [])
    .filter((row) => row.leadId === input.leadId && row.kind === "notes" && row.parkedReason === "notes_too_long")
    .slice()
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "") || (a.id || "").localeCompare(b.id || ""));
  let notes = input.notes;
  let baseNotes = input.baseNotes || "";
  for (const prior of priors) {
    const absorbed = absorbNotesText(
      { notes: prior.notes || "", baseNotes: prior.baseNotes || "" },
      { notes, baseNotes },
    );
    notes = absorbed.notes;
    baseNotes = absorbed.baseNotes;
  }
  const bytes = notesRouteBodyBytes({
    leadId: input.leadId,
    draftId: input.draftId ?? NOTES_DRAFT_ID_PLACEHOLDER,
    actionAt: input.actionAt ?? NOTES_ACTION_AT_PLACEHOLDER,
    notes,
    baseNotes,
  });
  const tooLong = notes.length > NOTES_MAX_CHARS
    || baseNotes.length > NOTES_MAX_CHARS
    || bytes > NOTES_ROUTE_BODY_MAX_BYTES;
  return { notes, baseNotes, tooLong, bytes };
}

/** The limit applies only when the rep changed the notes. An unchanged oversize note does not block. */
export function notesEditTooLong(input: {
  currentNotes: string;
  notes: string;
  leadId: string;
  baseNotes?: string | null;
  parkedNotes?: NotesLengthDraft[];
  draftId?: string;
  actionAt?: string;
}): boolean {
  if ((input.notes || "") === (input.currentNotes || "")) return false;
  return notesQueuedBody({
    leadId: input.leadId,
    notes: input.notes,
    baseNotes: input.baseNotes ?? input.currentNotes ?? "",
    parkedNotes: input.parkedNotes,
    draftId: input.draftId,
    actionAt: input.actionAt,
  }).tooLong;
}

/** Editor validation. Over the limit, Save stays disabled and nothing is queued. */
export async function saveNotesFromEditor(
  text: string,
  enqueue: (text: string) => Promise<void> | void,
  route?: Omit<Parameters<typeof notesQueuedBody>[0], "notes"> & { currentNotes?: string },
): Promise<void> {
  if (route?.currentNotes !== undefined) {
    if (notesEditTooLong({ ...route, currentNotes: route.currentNotes, notes: text }))
      throw Error(NOTES_TOO_LONG_MESSAGE);
    if (text === route.currentNotes && notesQueuedBody({ ...route, notes: text }).tooLong) return;
  } else if (route ? notesQueuedBody({ ...route, notes: text }).tooLong : notesTextTooLong(text)) {
    throw Error(NOTES_TOO_LONG_MESSAGE);
  }
  await enqueue(text);
}
