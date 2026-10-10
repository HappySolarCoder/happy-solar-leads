"use client";

import { useMemo, useState } from "react";
import { DoorOpen, Flag, X, Check } from "lucide-react";
import type { Lead } from "@/app/types";
import type { Disposition } from "@/app/types/disposition";
import { sessionAppointments, sessionDoors } from "../_lib/doorCoach";
import { useDeviceNow } from "./useDeviceNow";
import MobileDialog from "./MobileDialog";

type Session = { startedAt: string; target: number };
export default function DoorCoach({
  leads,
  userId,
  dispositions,
  now: previewNow,
}: {
  leads: Lead[];
  userId: string;
  dispositions: Disposition[];
  now?: Date;
}) {
  const [open, setOpen] = useState(false);
  const deviceNow = useDeviceNow();
  const now = previewNow || deviceNow;
  const [savedSession, setSession] = useState<Session | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = JSON.parse(
        localStorage.getItem(`raydar-focus:${userId}`) || "null"
      );
      return saved &&
        [1, 2, 3].includes(saved.target) &&
        typeof saved.startedAt === "string"
        ? saved
        : null;
    } catch {
      return null;
    }
  });
  const session =
    savedSession &&
    new Date(savedSession.startedAt).toDateString() === now.toDateString()
      ? savedSession
      : null;
  const appointments = useMemo(
    () => (session ? sessionAppointments(leads, userId, session.startedAt) : 0),
    [leads, userId, session]
  );
  const doors = useMemo(
    () =>
      session
        ? sessionDoors(leads, userId, session.startedAt, dispositions)
        : 0,
    [leads, userId, session, dispositions]
  );
  function save(next: Session | null) {
    setSession(next);
    try {
      if (next)
        localStorage.setItem(`raydar-focus:${userId}`, JSON.stringify(next));
      else localStorage.removeItem(`raydar-focus:${userId}`);
    } catch {
      /* Usable in memory if device storage is unavailable. */
    }
  }
  return (
    <>
      <div className="rm-door-actions">
        <button
          onClick={() => setOpen(true)}
          className={
            session && appointments >= session.target ? "is-complete" : ""
          }
          aria-label={`Open Focus, ${doors} doors knocked, ${appointments} appointments set${
            session ? ` of ${session.target}` : ""
          }`}
        >
          <Flag size={16} />
          <span>Focus</span>
          <span className="rm-focus-divider" />
          <span>{doors} doors</span>
          <span className="rm-focus-divider" />
          <span>
            {session ? `${appointments}/${session.target}` : appointments} set
          </span>
        </button>
      </div>
      {open && (
        <MobileDialog
          title="Door & appointment focus"
          onClose={() => setOpen(false)}
        >
          <div className="rm-coach-panel">
            <div className="rm-panel-heading">
              <span className="rm-eyebrow">EVERY CONVERSATION COUNTS</span>
              <button aria-label="Close focus" onClick={() => setOpen(false)}>
                <X size={22} />
              </button>
            </div>
            <h2>
              {session && appointments >= session.target
                ? "Goal reached. Nice work."
                : "Give this session a purpose."}
            </h2>
            {session ? (
              <>
                <div className="rm-focus-doors">
                  <DoorOpen size={24} />
                  <strong>{doors}</strong>
                  <span>doors knocked this session</span>
                </div>
                <div className="rm-focus-score">
                  <span>{appointments}</span>
                  <small>
                    / {session.target}
                    <br />
                    appointments set
                  </small>
                  {appointments >= session.target && <Check size={32} />}
                </div>
                <div
                  className="rm-focus-track"
                  role="progressbar"
                  aria-label="Session appointment goal"
                  aria-valuenow={Math.min(appointments, session.target)}
                  aria-valuemax={session.target}
                  aria-valuemin={0}
                >
                  <span
                    style={{
                      width: `${Math.min(
                        100,
                        (appointments / session.target) * 100
                      )}%`,
                    }}
                  />
                </div>
                <p>
                  Counts unique doors you knock and appointments you set after
                  starting this session. Repeated updates to the same door count
                  once.
                </p>
                <button className="rm-primary" onClick={() => setOpen(false)}>
                  Back to the doors
                </button>
                <button className="rm-coach-end" onClick={() => save(null)}>
                  End focus session
                </button>
              </>
            ) : (
              <>
                <p>
                  Choose an appointment goal to start tracking doors knocked and
                  appointments set together.
                </p>
                <div className="rm-focus-choices">
                  {[1, 2, 3].map((target) => (
                    <button
                      key={target}
                      onClick={() =>
                        save({ target, startedAt: now.toISOString() })
                      }
                    >
                      <b>{target}</b>
                      <span>
                        {target === 1 ? "appointment" : "appointments"}
                      </span>
                    </button>
                  ))}
                </div>
                <small className="rm-coach-footnote">
                  Personal session on this device. Uses your existing lead
                  updates.
                </small>
              </>
            )}
          </div>
        </MobileDialog>
      )}
    </>
  );
}
