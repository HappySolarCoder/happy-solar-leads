import type { Lead } from "@/app/types";
import { leadOwnedBy } from "./serverDispo";
import { SYNC_REASON } from "./syncReasons";
import type { PendingMutation } from "./types";

/** Shown in the Send Info panel. The scheduling notification was not posted. */
export const CONTACT_NOT_SENT_MESSAGE =
  "The contact info couldn't be saved and the info wasn't sent.";

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
  if (!input.canWriteContact || input.contactDenied || input.contactPending) {
    return { post: false, notice: CONTACT_NOT_SENT_MESSAGE };
  }
  // Offline, and this role may write contact fields: the draft stays durably
  // queued. Send Info does not post. That is unchanged. An ambiguous
  // notification response is never retried.
  if (!input.online) return { post: false };
  return { post: true };
}

/** Contact drafts the role cannot save. Already-parked denials are left as they are. */
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
 * One scheduling post, and only after the contact write is allowed.
 * A refusal returns the inline notice and does not call post.
 * Any other confirm() failure is rethrown with sendInfoSave so the editor
 * can alert it. post() runs once; the caller must not retry an ambiguous result.
 */
export async function finishSendInfo(input: {
  online: boolean;
  canWriteContact: boolean;
  /** A parked or still-unsent contact draft for this lead. Send Info does not post. */
  contactPending?: boolean;
  confirm: () => Promise<void>;
  post: () => Promise<void>;
}): Promise<{ posted: number; notice: string | null }> {
  const blocked = sendInfoPostDecision({
    online: input.online,
    canWriteContact: input.canWriteContact,
    contactDenied: false,
    contactPending: input.contactPending,
  });
  if (blocked.notice) {
    try {
      await input.confirm();
    } catch (error) {
      if (!contactSaveDeniedError(error)) throw Object.assign(error as Error, { sendInfoSave: true });
    }
    return { posted: 0, notice: blocked.notice };
  }
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
  });
  if (!decision.post) return { posted: 0, notice: decision.notice ?? null };
  await input.post();
  return { posted: 1, notice: null };
}
