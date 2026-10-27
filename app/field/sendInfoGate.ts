import type { Lead } from "@/app/types";
import { leadOwnedBy } from "./serverDispo";
import { SYNC_REASON } from "./syncReasons";
import type { PendingMutation } from "./types";

/** Shown in the Send Info panel. The scheduling notification was not posted. */
export const CONTACT_NOT_SENT_MESSAGE =
  "The contact info couldn't be saved and the info wasn't sent.";

/**
 * The scheduling post went out. The pin was not updated because this rep
 * cannot write contact fields on it.
 */
export const CONTACT_NOT_ON_PIN_NOTICE =
  "Info sent to Scheduling Manager. The contact info wasn't saved to this pin because it isn't assigned to you.";

/** An allowed writer still has a contact draft that has not landed. Send Info waits. */
export const CONTACT_STILL_SAVING_MESSAGE =
  "Contact info is still saving. Try Send Info again in a moment.";

/** Save Changes, when this rep cannot write contact fields on the pin. */
export const CONTACT_OWNER_ONLY_MESSAGE =
  "Only the pin owner or an admin can change contact info. Use Send Info to pass it to the Scheduling Manager.";

export const CONNECT_BEFORE_SEND_MESSAGE = "Connect before sending the scheduling request.";

/**
 * Live rules: an admin, or the rep who owns the lead, can write contact fields.
 * A non-owner cannot. That includes a territory setter and a manager.
 */
export function repMayWriteContactFields(
  lead: Pick<Lead, "claimedBy" | "assignedTo" | "setterId" | "source">,
  uid: string,
  role?: string,
): boolean {
  if (role === "admin") return true;
  return leadOwnedBy(lead, uid);
}

/**
 * The contact-write gate is native-only. Web Send Info keeps its previous
 * behavior and does not consult repMayWriteContactFields.
 */
export function sendInfoMayWriteContact(
  native: boolean,
  lead: Pick<Lead, "claimedBy" | "assignedTo" | "setterId" | "source"> | null | undefined,
  uid: string,
  role?: string,
): boolean {
  if (!native || !lead) return true;
  return repMayWriteContactFields(lead, uid, role);
}

/** Any contact draft still on the lead, parked or not yet written. */
export function contactDraftBlocksSendInfo(drafts: PendingMutation[], leadId: string): boolean {
  return drafts.some((row) => row.leadId === leadId && row.kind === "contact");
}

/**
 * Contact fields stay off the queued patch when this rep cannot write them.
 * Notes still save. Nothing is queued when the patch was only contact fields.
 */
export function patchWithoutLockedContact(
  mayWrite: boolean,
  patch: Partial<Lead> | null,
): { patch: Partial<Lead> | null; contactSkipped: boolean } {
  if (mayWrite || !patch) return { patch, contactSkipped: false };
  const contactKeys = Object.keys(patch).filter((key) => key !== "notes");
  if (!contactKeys.length) return { patch, contactSkipped: false };
  if (typeof patch.notes !== "string") return { patch: null, contactSkipped: true };
  return { patch: { notes: patch.notes }, contactSkipped: true };
}

/**
 * An allowed writer with a contact draft that is still queued cannot Send Info yet.
 * A parked contact draft does not throw. The caller parks, and never deletes, drafts
 * this role cannot write.
 */
export function assertContactReadyForSend(drafts: PendingMutation[], leadId: string): void {
  if (!contactDraftBlocksSendInfo(drafts, leadId)) return;
  const stillQueued = drafts.some((row) =>
    row.leadId === leadId && row.kind === "contact" && row.syncState !== "parked");
  if (stillQueued) throw Error(CONTACT_STILL_SAVING_MESSAGE);
}

export function contactSaveDeniedError(error: unknown): boolean {
  const value = error as { code?: string; message?: string; reasonCode?: string };
  return value?.code === "contact_denied"
    || value?.code === "permission-denied"
    || value?.reasonCode === SYNC_REASON.contactDenied
    || value?.message === CONTACT_NOT_SENT_MESSAGE;
}

export function sendInfoPostDecision(input: {
  online: boolean;
  canWriteContact: boolean;
  contactDenied: boolean;
  contactPending?: boolean;
}): { post: boolean; notice?: string } {
  // Offline never posts. An allowed writer's draft stays queued. A non-owner
  // is told to connect. An ambiguous notification response is never retried.
  if (!input.online) {
    if (!input.canWriteContact) return { post: false, notice: CONNECT_BEFORE_SEND_MESSAGE };
    return { post: false };
  }
  // This role can write, and a contact draft is still unsent. Do not post.
  if (input.canWriteContact && input.contactPending && !input.contactDenied) {
    return { post: false, notice: CONTACT_NOT_SENT_MESSAGE };
  }
  // The pin will not store the contact info. Scheduling still gets the form.
  if (!input.canWriteContact || input.contactDenied) {
    return { post: true, notice: CONTACT_NOT_ON_PIN_NOTICE };
  }
  return { post: true };
}

/**
 * Contact drafts the role cannot save. Already-parked denials are left as they are.
 * This never deletes a draft. The caller writes the parked copies back.
 */
export function parkContactDeniedDrafts(drafts: PendingMutation[], leadId: string): PendingMutation[] {
  const parked: PendingMutation[] = [];
  for (const row of drafts) {
    if (row.leadId !== leadId || row.kind !== "contact") continue;
    if (row.syncState === "parked" && row.parkedReason === SYNC_REASON.contactDenied) continue;
    const next: PendingMutation = {
      ...row,
      syncState: "parked",
      parkedReason: SYNC_REASON.contactDenied,
      lastError: CONTACT_NOT_SENT_MESSAGE,
    };
    delete next.nextAttemptAt;
    delete next.blocked;
    delete next.error;
    parked.push(next);
  }
  return parked;
}

/**
 * One scheduling post. A rep who cannot write contact fields still posts, and
 * a contactDenied result from confirm() still posts. Offline does not post.
 * An allowed writer's still-unsent contact draft does not post.
 * Any other confirm() failure is rethrown with sendInfoSave so the editor
 * can alert it. post() runs once; the caller must not retry an ambiguous result.
 */
export async function finishSendInfo(input: {
  online: boolean;
  canWriteContact: boolean;
  /** A still-unsent contact draft for an allowed writer. Send Info does not post. */
  contactPending?: boolean;
  confirm: () => Promise<void>;
  post: () => Promise<void>;
}): Promise<{ posted: number; notice: string | null }> {
  let contactDenied = false;
  try {
    await input.confirm();
  } catch (error) {
    if (!contactSaveDeniedError(error)) throw Object.assign(error as Error, { sendInfoSave: true });
    contactDenied = true;
  }
  const decision = sendInfoPostDecision({
    online: input.online,
    canWriteContact: input.canWriteContact,
    contactDenied,
    contactPending: input.contactPending,
  });
  if (!decision.post) return { posted: 0, notice: decision.notice ?? null };
  await input.post();
  return { posted: 1, notice: decision.notice ?? null };
}
