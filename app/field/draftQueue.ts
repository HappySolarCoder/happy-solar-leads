import type { FieldMutation, PendingMutation } from "./types";

/** A new dispo always joins the queue. Older drafts for the same lead stay. */
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
  return {
    ...pending,
    syncState: pending.syncState ?? (pending.direct?.gps ? "gps" : "queued"),
    attempts: pending.attempts ?? 0,
  };
}
