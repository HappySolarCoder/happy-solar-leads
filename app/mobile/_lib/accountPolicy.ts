/**
 * Native App Store account rules for 14.13.
 * The website build leaves self-signup and team-stat totals unchanged.
 * Account deletion is a confirmed in-app request: there is no new server route,
 * and knock, visit, and lead records are never deleted or rewritten here.
 */

/** Change this one constant if the privacy policy address moves. */
export const PRIVACY_POLICY_URL = "https://www.happyslr.com/privacy";

export const ACCOUNT_DELETION_MAILBOX = "evan@happyslr.com";

export const ACCOUNT_DELETION_STORAGE_KEY = "raydar-account-deletion-notice";

export const ACCOUNT_DELETION_OUTCOME =
  "Your account deletion request was started. An email to evan@happyslr.com was opened with your account email and id. Happy Solar will remove your sign-in. Knocks, visits, and leads you recorded are kept. You are signed out of this phone. Nothing waiting to sync was erased.";

export function isNativeBuild(): boolean {
  return process.env.NEXT_PUBLIC_NATIVE_BUILD === "1";
}

export function nativeSelfSignupEnabled(native = isNativeBuild()): boolean {
  return !native;
}

export function missingAccountMessage(native = isNativeBuild()): string {
  return native
    ? "No account found with this email. Contact your manager."
    : "No account found with this email. Please create one.";
}

/**
 * Website team stats still request company-wide leads for setter and closer.
 * The native build does not: those roles stay on the screen and use scoped leads.
 * Manager and admin keep the company-wide request on both.
 */
export function teamPerformanceMayRequestAllLeads(
  role: string | undefined,
  native = isNativeBuild(),
): boolean {
  if (role === "admin" || role === "manager") return true;
  if (native) return false;
  return role === "setter" || role === "closer";
}

export type PendingOutboxCounts = { drafts: number; recordings: number };

/** Fail closed: an unknown outbox is treated as pending so sign-out cannot proceed. */
export async function pendingOutboxWork(
  uid: string,
  readDrafts: (uid: string) => Promise<{ length: number }>,
  readRecordings: (uid: string) => Promise<{ length: number }>,
): Promise<PendingOutboxCounts | null> {
  try {
    const [drafts, recordings] = await Promise.all([
      readDrafts(uid),
      readRecordings(uid),
    ]);
    return { drafts: drafts.length, recordings: recordings.length };
  } catch {
    return null;
  }
}

export function deletionBlockedReason(pending: PendingOutboxCounts | null): string | null {
  if (!pending) {
    return "Raydar could not check for unsynced work on this phone. Stay signed in and try again. Nothing was deleted or erased.";
  }
  const drafts = Number.isFinite(pending.drafts) ? Math.max(0, Math.floor(pending.drafts)) : 0;
  const recordings = Number.isFinite(pending.recordings) ? Math.max(0, Math.floor(pending.recordings)) : 0;
  if (drafts === 0 && recordings === 0) return null;
  const parts = [
    drafts ? `${drafts} unsynced visit${drafts === 1 ? "" : "s"}` : "",
    recordings ? `${recordings} unsent recording${recordings === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `${parts.join(" and ")} still on this phone must sync before you can request deletion. Raydar will not sign you out, erase this phone, or change visit history.`;
}

export function deletionMailto(account: { email: string; uid: string }): string {
  const email = account.email.trim() || "(no email on profile)";
  const uid = account.uid.trim();
  const subject = "Raydar account deletion request";
  const body = [
    "Please delete my Raydar sign-in.",
    "",
    `Account email: ${email}`,
    `Account id: ${uid}`,
    "",
    "This request does not delete or change knock, visit, or lead history.",
  ].join("\n");
  return `mailto:${ACCOUNT_DELETION_MAILBOX}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
