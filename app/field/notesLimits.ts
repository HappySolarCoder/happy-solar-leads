/**
 * Limits for POST /api/field/dispo from PR #170.
 * Update this module when that route's limits change.
 * kind:notes accepts notes and baseNotes up to NOTES_MAX_CHARS and a JSON body
 * up to NOTES_ROUTE_BODY_MAX_BYTES. Above that the route returns 413
 * { error: "payload_too_large" }. Knock bodies stay at KNOCK_ROUTE_BODY_MAX_BYTES.
 * #171 rules still cap a non-owner direct notes write at NON_OWNER_DIRECT_NOTES_MAX_CHARS,
 * so a longer note on a lead this rep does not own uses the route.
 */
export const NOTES_MAX_CHARS = 100_000;
export const NOTES_ROUTE_BODY_MAX_BYTES = 262_144;
export const KNOCK_ROUTE_BODY_MAX_BYTES = 32_768;
export const NON_OWNER_DIRECT_NOTES_MAX_CHARS = 10_000;
export const NOTES_TOO_LONG_MESSAGE = "Notes too long";

export function notesTextTooLong(text: string): boolean {
  return text.length > NOTES_MAX_CHARS;
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Editor validation. Over the limit, Save stays disabled and nothing is queued. */
export async function saveNotesFromEditor(
  text: string,
  enqueue: (text: string) => Promise<void> | void,
): Promise<void> {
  if (notesTextTooLong(text)) throw Error(NOTES_TOO_LONG_MESSAGE);
  await enqueue(text);
}
