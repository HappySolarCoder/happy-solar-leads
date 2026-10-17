/**
 * Native App Store account rules for 14.14.
 * The website build leaves self-signup and team-stat totals unchanged.
 * Account deletion calls POST /api/account/request-deletion. Until that route
 * is deployed, a 404 falls back to the confirmed email handoff.
 * Knock, visit, and lead records are never deleted or rewritten here.
 */

/** Change this one constant if the privacy policy address moves. */
export const PRIVACY_POLICY_URL = "https://www.happyslr.com/privacy";

export const ACCOUNT_DELETION_MAILBOX = "evan@happyslr.com";

export const ACCOUNT_DELETION_STORAGE_KEY = "raydar-account-deletion-notice";

export const ACCOUNT_DELETION_PATH = "/api/account/request-deletion";

/** Shown before the person confirms, so the outcome is stated first. */
export const ACCOUNT_DELETION_CONFIRMATION =
  "Deleting your account disables sign-in right away. Happy Solar removes remaining profile details within 30 days. Knock and visit records the company needs stay with the company's lead records. Nothing on this phone is erased. If account deletion is not available yet, Raydar opens an email to evan@happyslr.com. You are signed out only after that email opens. If it cannot open, you stay signed in and Raydar shows the address to contact.";

export const ACCOUNT_DELETED_NOTICE =
  "Your account is deleted and sign-in is disabled. Happy Solar removes remaining profile details within 30 days. Knock and visit records the company needs stay with the company's lead records. You are signed out of this phone. Nothing on this phone was erased.";

export const ACCOUNT_DELETION_EMAIL_NOTICE =
  "Account deletion is not available in the app yet, so an email to evan@happyslr.com was opened with your account email and id. Happy Solar will disable your sign-in. Knock and visit records the company needs stay with the company's lead records. You are signed out of this phone. Nothing on this phone was erased.";

export const ACCOUNT_DELETION_MAIL_UNOPENED =
  "Raydar could not open an email. You are still signed in and nothing was deleted. Contact evan@happyslr.com with your account email and id.";

export const ACCOUNT_DELETION_SIGN_IN_AGAIN =
  "Sign in again and retry. You are still signed in and nothing was deleted.";

export const ACCOUNT_DELETION_ADMIN_BLOCKED =
  "Admin accounts can't be deleted in the app. You are still signed in and nothing was deleted.";

export const ACCOUNT_DELETION_SERVER_ERROR =
  "Happy Solar could not delete the account. You are still signed in and nothing was deleted. Try again.";

export const ACCOUNT_DELETION_OFFLINE =
  "Raydar could not reach Happy Solar. You are still signed in and nothing was deleted. Try again when you have a connection.";

export const ACCOUNT_DELETION_UNCONFIRMED =
  "Raydar could not confirm that the account was deleted. You are still signed in and nothing was deleted.";

const ADMIN_SELF_DELETE_ERROR = "admin-accounts-cannot-self-delete";

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
  const gps = drafts ? " Unsynced visits include pending GPS." : "";
  return `${parts.join(" and ")} still on this phone must sync before you can request deletion.${gps} Raydar will not sign you out, erase this phone, or change visit history.`;
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

export type AccountDeletionDecision =
  | { action: "sign-out"; notice: string }
  | { action: "email-fallback" }
  | { action: "stay"; message: string; retry: boolean };

function isRecord(body: unknown): body is Record<string, unknown> {
  return !!body && typeof body === "object";
}

/** Sign out only for a confirmed disable. Every other result stays signed in. */
export function interpretAccountDeletionResponse(
  status: number,
  body: unknown,
  networkError = false,
): AccountDeletionDecision {
  if (networkError) {
    return { action: "stay", message: ACCOUNT_DELETION_OFFLINE, retry: true };
  }
  if (status === 200 && isRecord(body) && body.ok === true && body.disabled === true) {
    return { action: "sign-out", notice: ACCOUNT_DELETED_NOTICE };
  }
  if (status === 404) return { action: "email-fallback" };
  if (status === 401) {
    return { action: "stay", message: ACCOUNT_DELETION_SIGN_IN_AGAIN, retry: true };
  }
  if (status === 403 && isRecord(body) && body.error === ADMIN_SELF_DELETE_ERROR) {
    return { action: "stay", message: ACCOUNT_DELETION_ADMIN_BLOCKED, retry: false };
  }
  if (status >= 500 && status <= 599) {
    return { action: "stay", message: ACCOUNT_DELETION_SERVER_ERROR, retry: true };
  }
  return { action: "stay", message: ACCOUNT_DELETION_UNCONFIRMED, retry: false };
}

/** The email fallback signs out only after the mail app actually takes over. */
export function afterMailtoHandoff(opened: boolean): AccountDeletionDecision {
  if (opened) return { action: "sign-out", notice: ACCOUNT_DELETION_EMAIL_NOTICE };
  return { action: "stay", message: ACCOUNT_DELETION_MAIL_UNOPENED, retry: false };
}

/**
 * True only when the page is hidden or the app is inactive after the mailto.
 * A focus loss from the "no mail account" alert is not a successful handoff.
 */
export async function resolveMailtoHandoff(options: {
  open: () => void;
  hidden: () => boolean;
  wait: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<boolean> {
  options.open();
  const timeoutMs = options.timeoutMs ?? 4000;
  const pollMs = options.pollMs ?? 50;
  const started = Date.now();
  for (;;) {
    if (options.hidden()) return true;
    if (Date.now() - started >= timeoutMs) return false;
    await options.wait(Math.min(pollMs, timeoutMs - (Date.now() - started)));
  }
}

type DeletionResponse = { status: number; json: () => Promise<unknown> };

/** POST with a bearer token and no body. A thrown request stays signed in. */
export async function requestAccountDeletion(
  token: string | null | undefined,
  fetchImpl: (path: string, init: { method: string; headers: { Authorization: string } }) => Promise<DeletionResponse>,
): Promise<AccountDeletionDecision> {
  if (!token) return interpretAccountDeletionResponse(401, { error: "Missing credentials" });
  let response: DeletionResponse;
  try {
    response = await fetchImpl(ACCOUNT_DELETION_PATH, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return interpretAccountDeletionResponse(0, null, true);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return interpretAccountDeletionResponse(response.status, body);
}
