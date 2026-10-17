"use client";

import { useRef, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import type { User } from "@/app/types";
import { signOut } from "@/app/utils/auth";
import { apiFetch } from "@/app/utils/apiFetch";
import { auth } from "@/app/utils/firebase";
import { readDrafts } from "@/app/field/deviceStore";
import { feedbackItems } from "../_lib/feedbackQueue";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  ACCOUNT_DELETION_MAILBOX,
  ACCOUNT_DELETION_STORAGE_KEY,
  ACCOUNT_DELETION_UNCONFIRMED,
  afterMailtoHandoff,
  deletionBlockedReason,
  deletionMailto,
  pendingOutboxWork,
  requestAccountDeletion,
  resolveMailtoHandoff,
  type AccountDeletionDecision,
  type PendingOutboxCounts,
} from "../_lib/accountPolicy";
import MobileDialog from "./MobileDialog";

/**
 * Deletes the signed-in account through POST /api/account/request-deletion.
 * A 404 falls back to email. Sign-out happens only after a confirmed disable
 * or a confirmed mail handoff. Device storage, leads, knocks, and visits stay.
 */
export default function AccountDeletion({
  user,
  onSignedOut,
}: {
  user: User;
  onSignedOut: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "checking" | "blocked" | "confirm" | "working" | "result">("idle");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(false);
  const [pending, setPending] = useState<PendingOutboxCounts | null>(null);
  const [workingCopy, setWorkingCopy] = useState("Asking Happy Solar to disable your sign-in…");
  const lock = useRef(false);

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

  async function mailtoOpened(): Promise<boolean> {
    let inactive = false;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") inactive = true;
    };
    document.addEventListener("visibilitychange", onVisibility);
    let removeApp: { remove: () => Promise<void> } | null = null;
    try {
      if (Capacitor.isNativePlatform()) {
        removeApp = await App.addListener("appStateChange", ({ isActive }) => {
          if (!isActive) inactive = true;
        });
      }
    } catch {
      /* The page-visibility check still decides the handoff. */
    }
    try {
      const href = deletionMailto({ email: user.email || "", uid: user.id });
      return await resolveMailtoHandoff({
        open: () => {
          window.location.href = href;
        },
        hidden: () => inactive || document.visibilityState === "hidden",
        wait: (ms) => new Promise((resolve) => {
          window.setTimeout(resolve, ms);
        }),
      });
    } finally {
      document.removeEventListener("visibilitychange", onVisibility);
      if (removeApp) await removeApp.remove().catch(() => {});
    }
  }

  async function finishSignOut(notice: string) {
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
      setMessage("Your account deletion was confirmed, but this phone could not finish signing out. Close Raydar and open it again. You are still signed in on this phone. Nothing on this phone was erased.");
      setPhase("result");
      lock.current = false;
      return;
    }
    onSignedOut();
  }

  function showStay(decision: Extract<AccountDeletionDecision, { action: "stay" }>) {
    setRetry(decision.retry);
    setMessage(decision.message);
    setPhase("result");
  }

  async function apply(decision: AccountDeletionDecision) {
    let resolved = decision;
    if (resolved.action === "email-fallback") {
      if (await blocked("You are still signed in.")) return;
      setWorkingCopy(`Opening an email to ${ACCOUNT_DELETION_MAILBOX}…`);
      resolved = afterMailtoHandoff(await mailtoOpened());
    }
    if (resolved.action === "sign-out") {
      await finishSignOut(resolved.notice);
      return;
    }
    if (resolved.action === "stay") showStay(resolved);
  }

  async function submit() {
    if (lock.current) return;
    lock.current = true;
    setWorkingCopy("Asking Happy Solar to disable your sign-in…");
    setPhase("working");
    setRetry(false);
    try {
      if (await blocked("You are still signed in.")) return;
      await apply(await requestAccountDeletion(await idToken(), (path, init) => apiFetch(path, init)));
    } catch {
      showStay({ action: "stay", message: ACCOUNT_DELETION_UNCONFIRMED, retry: true });
    } finally {
      lock.current = false;
    }
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
