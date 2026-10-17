"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@/app/types";
import { signOut } from "@/app/utils/auth";
import { apiFetch } from "@/app/utils/apiFetch";
import { auth } from "@/app/utils/firebase";
import { readDrafts } from "@/app/field/deviceStore";
import { feedbackItems } from "../_lib/feedbackQueue";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  ACCOUNT_DELETION_EMAIL_QUESTION,
  ACCOUNT_DELETION_EMAIL_SIGNOUT_FAILED,
  ACCOUNT_DELETION_LIKELY_DELETED,
  ACCOUNT_DELETION_MAILBOX,
  ACCOUNT_DELETION_SERVER_SIGNOUT_FAILED,
  ACCOUNT_DELETION_STORAGE_KEY,
  ACCOUNT_DELETION_UNKNOWN_OUTCOME,
  clearUnknownDeletionAttempt,
  deletionBlockedReason,
  deletionMailto,
  emailHandoffChoice,
  pendingOutboxWork,
  rememberUnknownDeletionAttempt,
  requestAccountDeletion,
  unknownDeletionAttempt,
  waitUntilAppIsVisible,
  type AccountDeletionDecision,
  type PendingOutboxCounts,
} from "../_lib/accountPolicy";
import MobileDialog from "./MobileDialog";

/**
 * Deletes the signed-in account through POST /api/account/request-deletion.
 * A 404 opens an email and asks whether it was sent. Sign-out happens only
 * after a confirmed disable or after the person says they sent the email.
 * Device storage, leads, knocks, and visits stay.
 */
export default function AccountDeletion({
  user,
  onSignedOut,
}: {
  user: User;
  onSignedOut: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "checking" | "blocked" | "confirm" | "working" | "email-confirm" | "result">("idle");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(false);
  const [pending, setPending] = useState<PendingOutboxCounts | null>(null);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const [workingCopy, setWorkingCopy] = useState("Asking Happy Solar to disable your sign-in…");
  const unknownRef = useRef(false);
  const lock = useRef(false);
  const mailto = deletionMailto({ email: user.email || "", uid: user.id });

  useEffect(() => {
    const stored = unknownDeletionAttempt(window.sessionStorage);
    unknownRef.current = stored;
    setUnknownOutcome(stored);
  }, []);

  function rememberUnknown() {
    unknownRef.current = true;
    setUnknownOutcome(true);
    rememberUnknownDeletionAttempt(window.sessionStorage);
  }

  function clearUnknown() {
    unknownRef.current = false;
    setUnknownOutcome(false);
    clearUnknownDeletionAttempt(window.sessionStorage);
  }

  function readUnknown(): boolean {
    if (unknownOutcome || unknownRef.current) return true;
    const stored = unknownDeletionAttempt(window.sessionStorage);
    if (!stored) return false;
    unknownRef.current = true;
    setUnknownOutcome(true);
    return true;
  }

  async function blocked(suffix = ""): Promise<boolean> {
    const counts = await pendingOutboxWork(user.id, readDrafts, feedbackItems);
    const reason = deletionBlockedReason(counts);
    if (!reason) return false;
    setPending(counts);
    setRetry(false);
    setMessage(suffix ? `${reason} ${suffix}` : reason);
    setPhase("blocked");
    return true;
  }

  async function begin() {
    if (lock.current) return;
    lock.current = true;
    setPhase("checking");
    const waiting = await blocked();
    lock.current = false;
    if (!waiting) {
      setPending(null);
      setPhase("confirm");
    }
  }

  async function idToken(): Promise<string | null> {
    const current = auth?.currentUser;
    if (!current || current.uid !== user.id) return null;
    try {
      return await current.getIdToken();
    } catch {
      return null;
    }
  }

  async function finishSignOut(notice: string, source: "server" | "email") {
    try {
      sessionStorage.setItem(ACCOUNT_DELETION_STORAGE_KEY, notice);
    } catch {
      /* Login still opens if the notice cannot be stored. */
    }
    try {
      await signOut();
    } catch {
      try {
        sessionStorage.removeItem(ACCOUNT_DELETION_STORAGE_KEY);
      } catch {
        /* The on-screen warning is the result that matters. */
      }
      setRetry(false);
      setMessage(source === "server" ? ACCOUNT_DELETION_SERVER_SIGNOUT_FAILED : ACCOUNT_DELETION_EMAIL_SIGNOUT_FAILED);
      setPhase("result");
      lock.current = false;
      return;
    }
    clearUnknown();
    onSignedOut();
  }

  async function leaveLikelyDeleted() {
    setMessage(ACCOUNT_DELETION_LIKELY_DELETED);
    setWorkingCopy(ACCOUNT_DELETION_LIKELY_DELETED);
    try {
      sessionStorage.setItem(ACCOUNT_DELETION_STORAGE_KEY, ACCOUNT_DELETION_LIKELY_DELETED);
    } catch {
      /* Login still opens if the notice cannot be stored. */
    }
    clearUnknown();
    try {
      await signOut();
    } catch {
      /* Firebase may already have signed this phone out. */
    }
    onSignedOut();
  }

  function showStay(decision: Extract<AccountDeletionDecision, { action: "stay" }>) {
    if (decision.unknown) rememberUnknown();
    else clearUnknown();
    setRetry(decision.retry);
    setMessage(decision.message);
    setPhase("result");
  }

  async function askAboutEmail() {
    const href = mailto;
    try {
      window.location.href = href;
    } catch {
      /* The question below still shows the address. */
    }
    await waitUntilAppIsVisible({
      hidden: () => document.visibilityState === "hidden",
      wait: (ms) => new Promise((resolve) => {
        window.setTimeout(resolve, ms);
      }),
    });
    setPhase("email-confirm");
  }

  async function apply(decision: AccountDeletionDecision) {
    if (decision.action === "email-fallback") {
      if (await blocked("You are still signed in.")) return;
      clearUnknown();
      setWorkingCopy(`Opening an email to ${ACCOUNT_DELETION_MAILBOX}…`);
      await askAboutEmail();
      return;
    }
    if (decision.action === "likely-deleted") {
      await leaveLikelyDeleted();
      return;
    }
    if (decision.action === "sign-out") {
      await finishSignOut(decision.notice, "server");
      return;
    }
    if (decision.action === "stay") showStay(decision);
  }

  async function submit() {
    if (lock.current) return;
    lock.current = true;
    setWorkingCopy("Asking Happy Solar to disable your sign-in…");
    setPhase("working");
    setRetry(false);
    try {
      if (await blocked("You are still signed in.")) return;
      const earlierUnknown = readUnknown();
      const token = await idToken();
      if (earlierUnknown && !token) {
        await leaveLikelyDeleted();
        return;
      }
      await apply(await requestAccountDeletion(token, (path, init) => apiFetch(path, init), earlierUnknown));
    } catch {
      rememberUnknown();
      showStay({ action: "stay", message: ACCOUNT_DELETION_UNKNOWN_OUTCOME, retry: true, unknown: true });
    } finally {
      lock.current = false;
    }
  }

  async function confirmEmailSent() {
    if (lock.current) return;
    lock.current = true;
    setPhase("working");
    setWorkingCopy("Signing out…");
    try {
      if (await blocked("You are still signed in.")) return;
      const choice = emailHandoffChoice(true);
      if (choice.action === "sign-out") await finishSignOut(choice.notice, "email");
    } finally {
      lock.current = false;
    }
  }

  function declineEmail() {
    const choice = emailHandoffChoice(false);
    if (choice.action === "stay") showStay(choice);
  }

  return (
    <>
      <button
        type="button"
        className="rm-delete-account"
        onClick={() => void begin()}
        disabled={phase === "checking" || phase === "working"}
      >
        {phase === "checking" ? "Checking unsynced work…" : "Delete my account"}
      </button>
      {phase === "blocked" && (
        <MobileDialog title="Account deletion is waiting" onClose={() => setPhase("idle")}>
          <h2>Account deletion is waiting</h2>
          <p className="rm-copy" role="alert">{message}</p>
          {!!pending?.drafts && (
            <a href="/mobile/field-tools/?tab=sync">Review unsynced visits</a>
          )}
          <button type="button" className="rm-quiet" onClick={() => setPhase("idle")}>
            Close
          </button>
        </MobileDialog>
      )}
      {phase === "confirm" && (
        <MobileDialog title="Delete my account" onClose={() => setPhase("idle")}>
          <h2>Delete my account</h2>
          <p className="rm-copy">{ACCOUNT_DELETION_CONFIRMATION}</p>
          <button type="button" className="rm-primary rm-full" onClick={() => void submit()}>
            Delete my account
          </button>
          <button type="button" className="rm-quiet" onClick={() => setPhase("idle")}>
            Cancel
          </button>
        </MobileDialog>
      )}
      {phase === "email-confirm" && (
        <MobileDialog title={ACCOUNT_DELETION_EMAIL_QUESTION} onClose={declineEmail}>
          <h2>{ACCOUNT_DELETION_EMAIL_QUESTION}</h2>
          <p className="rm-copy">
            You can email {ACCOUNT_DELETION_MAILBOX} yourself. Include your account email and id.
          </p>
          <a href={mailto}>Email {ACCOUNT_DELETION_MAILBOX}</a>
          <button type="button" className="rm-primary rm-full" onClick={() => void confirmEmailSent()}>
            I sent it, sign me out
          </button>
          <button type="button" className="rm-quiet" onClick={declineEmail}>
            Not yet
          </button>
        </MobileDialog>
      )}
      {(phase === "working" || phase === "result") && (
        <MobileDialog
          title={phase === "working" ? "Deleting account" : "Account deletion"}
          onClose={() => {
            if (phase === "result") setPhase("idle");
          }}
        >
          <h2>{phase === "working" ? "Deleting account" : "Account deletion"}</h2>
          <p className="rm-copy" role="status">
            {phase === "working" ? workingCopy : message}
          </p>
          {phase === "result" && message.includes(ACCOUNT_DELETION_MAILBOX) && (
            <a href={mailto}>Email {ACCOUNT_DELETION_MAILBOX}</a>
          )}
          {phase === "result" && retry && (
            <button type="button" className="rm-primary rm-full" onClick={() => void submit()}>
              Retry
            </button>
          )}
          {phase === "result" && (
            <button type="button" className="rm-quiet" onClick={() => setPhase("idle")}>
              Close
            </button>
          )}
        </MobileDialog>
      )}
    </>
  );
}
