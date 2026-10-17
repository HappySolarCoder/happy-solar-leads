/**
 * Native App Store account rules for 14.14.
 * The website build leaves self-signup and team-stat totals unchanged.
 * Account deletion calls POST /api/account/request-deletion. Until that route
 * is deployed, a 404 opens an email and asks whether it was sent.
 * Knock, visit, and lead records are never deleted or rewritten here.
 */

/** Change this one constant if the privacy policy address moves. */
export const PRIVACY_POLICY_URL = "https://www.happyslr.com/privacy";

export const ACCOUNT_DELETION_MAILBOX = "evan@happyslr.com";

export const ACCOUNT_DELETION_STORAGE_KEY = "raydar-account-deletion-notice";

/** Set when a deletion request ended without a definite yes or no. */
export const ACCOUNT_DELETION_UNKNOWN_KEY = "raydar-account-deletion-unknown";

export const ACCOUNT_DELETION_PATH = "/api/account/request-deletion";

/** Shown before the person confirms, so the outcome is stated first. */
export const ACCOUNT_DELETION_CONFIRMATION =
  "Deleting your account disables sign-in right away. Happy Solar removes remaining profile details within 30 days. Knock and visit records the company needs stay with the company's lead records. Nothing on this phone is erased. If account deletion is not available yet, Raydar opens an email to evan@happyslr.com. You are signed out only after you confirm that you sent that email. The address stays on screen so you can send it yourself.";

export const ACCOUNT_DELETED_NOTICE =
  "Your account is deleted and sign-in is disabled. Happy Solar removes remaining profile details within 30 days. Knock and visit records the company needs stay with the company's lead records. You are signed out of this phone. Nothing on this phone was erased.";

export const ACCOUNT_DELETION_EMAIL_NOTICE =
  "You sent the deletion email to evan@happyslr.com with your account email and id. Happy Solar will disable your sign-in. Knock and visit records the company needs stay with the company's lead records. You are signed out of this phone. Nothing on this phone was erased.";

export const ACCOUNT_DELETION_EMAIL_QUESTION =
  `Did you send the deletion email to ${ACCOUNT_DELETION_MAILBOX}?`;

export const ACCOUNT_DELETION_EMAIL_NOT_SENT =
  `You are still signed in and nothing was deleted. Email ${ACCOUNT_DELETION_MAILBOX} with your account email and id when you are ready.`;

export const ACCOUNT_DELETION_SERVER_SIGNOUT_FAILED =
  "Your account deletion was confirmed, but this phone could not finish signing out. Close Raydar and open it again. You are still signed in on this phone. Nothing on this phone was erased.";

export const ACCOUNT_DELETION_EMAIL_SIGNOUT_FAILED =
  "The request email was sent, but sign-out failed. Sign out from More.";

export const ACCOUNT_DELETION_SIGN_IN_AGAIN =
  "Sign in again and retry. You are still signed in and nothing was deleted.";

export const ACCOUNT_DELETION_ADMIN_BLOCKED =
  "Admin accounts can't be deleted in the app. You are still signed in and nothing was deleted.";

export const ACCOUNT_DELETION_UNKNOWN_OUTCOME =
  "Raydar could not confirm whether the deletion went through. If sign-in later reports the account is disabled, the deletion succeeded.";

export const ACCOUNT_DELETION_SERVER_ERROR = ACCOUNT_DELETION_UNKNOWN_OUTCOME;

export const ACCOUNT_DELETION_OFFLINE = ACCOUNT_DELETION_UNKNOWN_OUTCOME;

export const ACCOUNT_DELETION_LIKELY_DELETED =
  "Your account was most likely already deleted. Sign-in is disabled.";

export const ACCOUNT_DELETION_LIKELY_SIGNOUT_FAILED =
  "Your account was most likely already deleted. Sign-in is disabled. Sign out from More.";

export const ACCOUNT_TOKEN_DISABLED_CODE = "auth/user-disabled";

export const ACCOUNT_TOKEN_EXPIRED_CODE = "auth/user-token-expired";

export const ACCOUNT_TOKEN_NETWORK_CODE = "auth/network-request-failed";

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
  | { action: "likely-deleted"; notice: string }
  | { action: "email-fallback" }
  | { action: "stay"; message: string; retry: boolean; unknown?: boolean };

type DeletionMemory = {
  getItem: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

/** The stored value is the uid the unknown attempt belonged to. */
export function rememberUnknownDeletionAttempt(storage: DeletionMemory | null, uid: string): void {
  if (!uid) return;
  try {
    storage?.setItem?.(ACCOUNT_DELETION_UNKNOWN_KEY, uid);
  } catch {
    /* The component state still remembers this attempt. */
  }
}

export function unknownDeletionAttempt(storage: DeletionMemory | null, uid: string): boolean {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(ACCOUNT_DELETION_UNKNOWN_KEY) ?? null;
  } catch {
    return false;
  }
  if (!stored || !uid) return false;
  if (stored === uid) return true;
  clearUnknownDeletionAttempt(storage);
  return false;
}

export function clearUnknownDeletionAttempt(storage: DeletionMemory | null): void {
  try {
    storage?.removeItem?.(ACCOUNT_DELETION_UNKNOWN_KEY);
  } catch {
    /* A failed clear must not sign the user out. */
  }
}

function isRecord(body: unknown): body is Record<string, unknown> {
  return !!body && typeof body === "object";
}

/**
 * Sign out only for a confirmed disable.
 * A 500 `{ok:false, error:'Internal error'}` is both the profile-write failure
 * (Auth still enabled) and the route's generic catch, so the body does not
 * prove the account was left enabled. The wording stays unconfirmed. A later
 * HTTP 401 is still "sign in again"; only a Firebase disabled or expired
 * token, or a cleared currentUser, leaves as likely deleted.
 */
export function interpretAccountDeletionResponse(
  status: number,
  body: unknown,
  networkError = false,
): AccountDeletionDecision {
  if (networkError) {
    return { action: "stay", message: ACCOUNT_DELETION_UNKNOWN_OUTCOME, retry: true, unknown: true };
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
    return { action: "stay", message: ACCOUNT_DELETION_UNKNOWN_OUTCOME, retry: true, unknown: true };
  }
  return { action: "stay", message: ACCOUNT_DELETION_UNCONFIRMED, retry: false };
}

export type AccountTokenRead =
  | { kind: "token"; token: string }
  | { kind: "likely-deleted" }
  | { kind: "unknown" };

/** A missing token is not a deleted account unless Firebase says the user is gone. */
export function classifyAccountToken(input: {
  currentUserUid: string | null | undefined;
  expectedUid: string;
  token?: string | null;
  errorCode?: string | null;
}): AccountTokenRead {
  if (!input.currentUserUid) return { kind: "likely-deleted" };
  if (input.currentUserUid !== input.expectedUid) return { kind: "unknown" };
  if (input.token) return { kind: "token", token: input.token };
  if (input.errorCode === ACCOUNT_TOKEN_DISABLED_CODE || input.errorCode === ACCOUNT_TOKEN_EXPIRED_CODE) {
    return { kind: "likely-deleted" };
  }
  return { kind: "unknown" };
}

/** Stay on this screen when local sign-out fails. Do not open login. */
export function afterLikelyDeletedSignOut(signedOut: boolean):
  | { action: "leave"; notice: string }
  | { action: "stay"; message: string; retry: false } {
  if (signedOut) return { action: "leave", notice: ACCOUNT_DELETION_LIKELY_DELETED };
  return { action: "stay", message: ACCOUNT_DELETION_LIKELY_SIGNOUT_FAILED, retry: false };
}

/** The person decides whether the email was sent. Hiding the app is not a yes. */
export function emailHandoffChoice(sent: boolean): AccountDeletionDecision {
  if (sent) return { action: "sign-out", notice: ACCOUNT_DELETION_EMAIL_NOTICE };
  return { action: "stay", message: ACCOUNT_DELETION_EMAIL_NOT_SENT, retry: false };
}

/** Wait until the screen is visible. This does not decide that an email was sent. */
export async function waitUntilAppIsVisible(options: {
  hidden: () => boolean;
  wait: (ms: number) => Promise<void>;
  settleMs?: number;
  pollMs?: number;
}): Promise<void> {
  await options.wait(options.settleMs ?? 350);
  const pollMs = options.pollMs ?? 100;
  while (options.hidden()) await options.wait(pollMs);
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
