"use client";

import { useRef, useState, type MouseEvent } from "react";
import type { User } from "@/app/types";
import { signOut } from "@/app/utils/auth";
import { readDrafts } from "@/app/field/deviceStore";
import { feedbackItems } from "../_lib/feedbackQueue";
import {
  ACCOUNT_DELETION_MAILBOX,
  ACCOUNT_DELETION_OUTCOME,
  ACCOUNT_DELETION_STORAGE_KEY,
  deletionBlockedReason,
  deletionMailto,
  pendingOutboxWork,
  type PendingOutboxCounts,
} from "../_lib/accountPolicy";
import MobileDialog from "./MobileDialog";

/**
 * Starts account deletion without a server route.
 * Opens a prefilled email, then signs the user out.
 * Never deletes leads, knocks, drafts, or recordings, and never wipes device storage.
 */
export default function AccountDeletion({
  user,
  onSignedOut,
}: {
  user: User;
  onSignedOut: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "checking" | "blocked" | "confirm">("idle");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<PendingOutboxCounts | null>(null);
  const lock = useRef(false);
  const mailto = deletionMailto({ email: user.email || "", uid: user.id });

  async function begin() {
    if (lock.current) return;
    lock.current = true;
    setPhase("checking");
    const counts = await pendingOutboxWork(user.id, readDrafts, feedbackItems);
    lock.current = false;
    const reason = deletionBlockedReason(counts);
    if (reason) {
      setPending(counts);
      setMessage(reason);
      setPhase("blocked");
      return;
    }
    setPending(null);
    setPhase("confirm");
  }

  function send(event: MouseEvent<HTMLAnchorElement>) {
    if (lock.current) {
      event.preventDefault();
      return;
    }
    lock.current = true;
    void complete();
  }

  async function complete() {
    const counts = await pendingOutboxWork(user.id, readDrafts, feedbackItems);
    const reason = deletionBlockedReason(counts);
    if (reason) {
      lock.current = false;
      setPending(counts);
      setMessage(`${reason} If an email draft opened, discard it. You are still signed in.`);
      setPhase("blocked");
      return;
    }
    try {
      sessionStorage.setItem(ACCOUNT_DELETION_STORAGE_KEY, ACCOUNT_DELETION_OUTCOME);
    } catch {
      /* The confirm dialog already states the outcome if storage is unavailable. */
    }
    try {
      await signOut();
    } catch {
      try {
        sessionStorage.removeItem(ACCOUNT_DELETION_STORAGE_KEY);
      } catch {
        /* The signed-in warning below is the outcome that matters. */
      }
      lock.current = false;
      setMessage("The email was opened, but sign-out failed. You are still signed in. Nothing was deleted.");
      setPhase("blocked");
      return;
    }
    onSignedOut();
  }

  return (
    <>
      <button
        type="button"
        className="rm-delete-account"
        onClick={() => void begin()}
        disabled={phase === "checking"}
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
        <MobileDialog
          title="Request account deletion"
          onClose={() => {
            if (!lock.current) setPhase("idle");
          }}
        >
          <h2>Request account deletion</h2>
          <p className="rm-copy">
            This asks Happy Solar to delete your Raydar sign-in. It does not delete or change knocks, visits, or leads.
          </p>
          <p className="rm-copy">
            Raydar will open an email to {ACCOUNT_DELETION_MAILBOX} with your account email and id, then sign you out of this phone. Your visit history stays in the company records. Nothing on this phone is erased.
          </p>
          <a className="rm-primary rm-full" href={mailto} onClick={send}>
            Email deletion request and sign out
          </a>
          <button type="button" className="rm-quiet" onClick={() => setPhase("idle")}>
            Cancel
          </button>
        </MobileDialog>
      )}
    </>
  );
}
