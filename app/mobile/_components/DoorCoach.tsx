"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Compass, Flag, X, Check } from "lucide-react";
import type { Lead } from "@/app/types";
import { fieldPinArtwork } from "@/app/utils/fieldPin";
import { suggestDoors, sessionAppointments } from "../_lib/doorCoach";
import MobileDialog from "./MobileDialog";

type Session = { startedAt: string; target: number };
export default function DoorCoach({
  leads,
  userId,
  position,
  onLead,
  now: previewNow,
}: {
  leads: Lead[];
  userId: string;
  position?: [number, number];
  onLead: (lead: Lead) => void;
  now?: Date;
}) {
  const [panel, setPanel] = useState<"next" | "focus" | null>(null);
  const [session, setSession] = useState<Session | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = JSON.parse(
        localStorage.getItem(`raydar-focus:${userId}`) || "null",
      );
      return saved &&
        [1, 2, 3].includes(saved.target) &&
        new Date(saved.startedAt).toDateString() === new Date().toDateString()
        ? saved
        : null;
    } catch {
      return null;
    }
  });
  const now = previewNow || new Date();
  const dayKey = now.toDateString();
  const suggestions = useMemo(
    () =>
      panel === "next"
        ? suggestDoors(leads, userId, position, new Date(dayKey))
        : [],
    [panel, leads, userId, position, dayKey],
  );
  const appointments = useMemo(
    () => (session ? sessionAppointments(leads, userId, session.startedAt) : 0),
    [leads, userId, session],
  );
  function save(next: Session | null) {
    setSession(next);
    try {
      if (next)
        localStorage.setItem(`raydar-focus:${userId}`, JSON.stringify(next));
      else localStorage.removeItem(`raydar-focus:${userId}`);
    } catch {
      /* Still usable for this screen when device storage is unavailable. */
    }
  }
  return (
    <>
      <div className="rm-door-actions">
        <button onClick={() => setPanel("next")}>
          <Compass size={18} />
          Next door
        </button>
        <button
          onClick={() => setPanel("focus")}
          className={
            session && appointments >= session.target ? "is-complete" : ""
          }
        >
          <Flag size={16} />
          {session ? `${appointments}/${session.target} set` : "Focus"}
        </button>
      </div>
      {panel && (
        <MobileDialog
          title={
            panel === "next" ? "Next door suggestions" : "Appointment focus"
          }
          onClose={() => setPanel(null)}
        >
          <div className="rm-coach-panel">
            <div className="rm-panel-heading">
              <span className="rm-eyebrow">
                {panel === "next"
                  ? "MAKE YOUR NEXT DOOR COUNT"
                  : "ONE GOOD APPOINTMENT AT A TIME"}
              </span>
              <button
                aria-label="Close door coach"
                onClick={() => setPanel(null)}
              >
                <X size={22} />
              </button>
            </div>
            {panel === "next" ? (
              <>
                <h2>Your next good conversation.</h2>
                <p>
                  Due go-backs and warm leads first, then unworked solar roofs
                  within one mile. Distances are straight-line, not walking
                  routes.
                </p>
                {!position ? (
                  <div className="rm-coach-empty">
                    Enable location to find your nearby assigned doors.
                  </div>
                ) : !suggestions.length ? (
                  <div className="rm-coach-empty">
                    No matching doors nearby. Check your follow-ups or move to
                    your next assigned block.
                  </div>
                ) : (
                  <div className="rm-coach-queue">
                    {suggestions.map(({ lead, reason, distance }) => (
                      <button
                        key={lead.id}
                        onClick={() => {
                          setPanel(null);
                          onLead(lead);
                        }}
                      >
                        {/* Static vector pin image shares the live map artwork. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={fieldPinArtwork(lead, undefined, 17).url}
                          alt=""
                          width={34}
                          height={40}
                        />
                        <span>
                          <strong>{lead.address}</strong>
                          <small>{reason}</small>
                          <em>
                            {distance < 0.1
                              ? `${Math.round(distance * 5280)} ft`
                              : `${distance.toFixed(1)} mi`}{" "}
                            away
                          </em>
                        </span>
                        <ArrowUpRight size={18} />
                      </button>
                    ))}
                  </div>
                )}
                <div className="rm-coach-tip">
                  <strong>Before you book</strong>
                  <p>
                    Confirm the homeowner’s interest, best contact number,
                    agreed date and time, and any notes your sales consultant
                    needs.
                  </p>
                </div>
              </>
            ) : (
              <>
                <h2>
                  {session && appointments >= session.target
                    ? "Goal reached. Nice work."
                    : "Give this session a purpose."}
                </h2>
                {session ? (
                  <>
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
                          width: `${Math.min(100, (appointments / session.target) * 100)}%`,
                        }}
                      />
                    </div>
                    <p>
                      Counts unique doors you mark Appointment Set after
                      starting. Quality matters: a useful appointment gives the
                      consultant a clear next step.
                    </p>
                    <button
                      className="rm-primary"
                      onClick={() => setPanel(null)}
                    >
                      Back to the doors
                    </button>
                    <button className="rm-coach-end" onClick={() => save(null)}>
                      End focus session
                    </button>
                  </>
                ) : (
                  <>
                    <p>
                      Choose your appointment goal. No countdown or speed
                      contest—just a clear target while you work.
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
                      Personal goal on this device. Your company goals stay
                      unchanged.
                    </small>
                  </>
                )}
              </>
            )}
          </div>
        </MobileDialog>
      )}
    </>
  );
}
